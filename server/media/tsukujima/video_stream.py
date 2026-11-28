# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project
#
# 変更点:
# - KonomiTV は RecordedProgram/RecordedVideo (Tortoise ORM) を受け取るが、
#   encode_auto では recordings dict から組み立てた VideoSource を受け取る。
# - 録画再生は ingest 収集の key_frames から segment_map を起動時生成するため、
#   再生時オンデマンドのキーフレーム探索 (TSKeyFrameSeeker)・segment_map の DB 永続
#   (saveSegmentMapEntries) を撤去している。
# - MP4 経路は MP4KeyFrameParser を使用して moov から同期サンプル DTS を取得する。

from __future__ import annotations

import asyncio
import bisect
import logging
import math
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import ClassVar, Literal

from biim.mpeg2ts import ts

from .quality import QUALITY_TYPES
from .stream_encoding_options import StreamEncodingOptions
from .video_encoding_task import VideoEncodingTask
from .video_segment_planner import VideoSegmentPlanner
from .video_types import KeyFrame, SegmentMapEntry

logger = logging.getLogger(__name__)

# 実行中のバックグラウンドタスクへの強参照を保持し、GC による中断を防ぐ
_background_tasks: set[asyncio.Task] = set()


def _set_timeout(callback: Callable[[], object], delay: float) -> Callable[[], None]:
    """JavaScript の setTimeout 相当。delay 秒後に callback を呼ぶ。戻り値はキャンセル関数。
    KonomiTV app.utils.SetTimeout 準拠。"""
    is_cancelled = False

    async def _timeout() -> None:
        await asyncio.sleep(delay)
        if not is_cancelled:
            callback()

    def _cancel() -> None:
        nonlocal is_cancelled
        is_cancelled = True

    task = asyncio.create_task(_timeout())
    _background_tasks.add(task)
    task.add_done_callback(lambda _: _background_tasks.discard(task))
    return _cancel


@dataclass
class VideoSource:
    """
    録画再生セッションが必要とする録画ファイルのメタ情報。
    recordings dict から組み立てる（KonomiTV の RecordedVideo 相当）。
    """
    id: int                                          # recordings.id（ログ/識別用）
    file_path: str                                   # 入力 TS ファイルの絶対パス
    duration: float                                  # 総再生時間（秒）
    video_frame_rate: float                          # フレームレート（不明なら 0 → 6秒固定セグメント）
    key_frames: list[KeyFrame] = field(default_factory=list)  # ingest 収集のキーフレーム
    container_format: Literal['MPEG-TS', 'MPEG-4'] = 'MPEG-TS'
    has_video_stream_changes: bool = False           # 映像ストリーム構成が途中で変わるか
    # エンコードオプション構築に使う入力映像のメタ情報（probe_result / eit_video_info 由来）
    video_codec: Literal['MPEG-2', 'H.264', 'H.265'] = 'MPEG-2'
    video_scan_type: Literal['Interlaced', 'Progressive'] = 'Interlaced'
    video_resolution_width: int = 1920
    video_resolution_height: int = 1080
    # 表示の縦横比（幅 × 画素の縦横比 ÷ 高さ。4:3 なら 1.333）。分からない時は None（縦長だけ幅と高さで見分ける）
    video_display_aspect: float | None = None
    # 放送識別子（tsreadex のサービス選択 -n / 将来の psisimux -b に使う。recordings の onid/tsid/sid 由来）
    network_id: int | None = None
    transport_stream_id: int | None = None
    service_id: int | None = None


@dataclass
class VideoStreamSegment:
    """ビデオストリームの HLS セグメントを表すデータクラス"""
    sequence_index: int
    playlist_start_seconds: float
    source_file_position: int | None
    source_start_dts: int | None
    duration_seconds: float
    encode_status: Literal['Pending', 'Encoding', 'Completed']
    encoded_segment_ts_future: asyncio.Future[bytes]
    is_encoded_segment_ts_future_readed: bool = False

    async def resetState(self) -> None:
        """このセグメントの状態をリセットし、Future を初期化して Pending に戻す。"""
        if not self.encoded_segment_ts_future.done():
            self.encoded_segment_ts_future.set_result(b'')
        self.encode_status = 'Pending'
        self.encoded_segment_ts_future = asyncio.get_running_loop().create_future()
        self.is_encoded_segment_ts_future_readed = False


class VideoStream:
    """ 録画視聴セッションを管理するクラス """

    # 再生されていない場合にセッションを破棄するまでの時間 (秒)
    SESSION_TIMEOUT: ClassVar[float] = 10.0
    # 一度でも読み取られた HLS セグメントの最大保持数
    MAX_READED_SEGMENTS: ClassVar[int] = 10
    # QSVEncC の DTS 33bit ラップアラウンド回避のための余裕 (秒)
    DTS_WRAP_AVOIDANCE_SECONDS: ClassVar[int] = 60
    # DTS ラップ回避で遡る最大セグメント数
    DTS_WRAP_AVOIDANCE_MAX_BACKTRACK_SEGMENTS: ClassVar[int] = 40

    # セッション ID をキーとしたインスタンス辞書 (Singleton)
    __instances: ClassVar[dict[str, VideoStream]] = {}

    def __new__(
        cls,
        session_id: str,
        video_source: VideoSource,
        quality: QUALITY_TYPES,
        encoding_options: StreamEncodingOptions | None = None,
        encoder: str = 'FFmpeg',
        secondary_audio: bool = False,
        is_new_session_allowed: bool = False,
        audio_only: bool = False,
    ) -> VideoStream:

        if session_id not in cls.__instances:
            # 録画視聴セッションはプレイリスト API での初回作成時だけ新規作成を許可する
            if is_new_session_allowed is False or encoding_options is None:
                requested = encoding_options or StreamEncodingOptions()
                logger.error(
                    f'[Video: {video_source.id}/{session_id}/{quality}{requested.buildSuffix()}] '
                    f'Session does not exist.'
                )
                raise RuntimeError('Session does not exist')

            instance = super().__new__(cls)
            instance.session_id = session_id
            instance.video_source = video_source
            instance.quality = quality
            instance.encoding_options = encoding_options
            instance.encoder = encoder
            instance.secondary_audio = secondary_audio  # 副音声(a:1)を単一出力するか
            instance.audio_only = audio_only  # 映像を出さず音声だけを配るか

            # HLS セグメントの基準長 (秒)
            instance._segment_duration_seconds = VideoSegmentPlanner.computeSegmentDurationSeconds(
                video_source.video_frame_rate,
            )

            instance._segments = []

            # ingest 収集の key_frames から segment_map を生成し、シーケンス番号で引けるようにする
            ## 再生中はファイル探索せず、ここで作った辞書（とフォールバックの直接探索）で位置解決する
            instance._key_frames = sorted(video_source.key_frames, key=lambda kf: kf['dts'])
            instance._key_frame_dts_list = [kf['dts'] for kf in instance._key_frames]
            instance._segment_map_by_sequence = {
                entry['sequence_index']: entry
                for entry in VideoSegmentPlanner.convertKeyFramesToSegmentMap(
                    video_source.key_frames,
                    video_source.video_frame_rate,
                    video_source.duration,
                )
            }

            # MP4 コンテナ用: moov から読んだ同期サンプル DTS キャッシュ（セッション中に再利用）
            instance._mp4_keyframe_dts_list = None

            # 現在実行中の VideoEncodingTask とその管理用
            instance._video_encoding_task = VideoEncodingTask(instance)
            instance._video_encoding_task_lock = asyncio.Lock()
            instance._video_encoding_task_ref = None
            instance._detached_video_encoding_task_refs = set()

            # SESSION_TIMEOUT 秒後にインスタンスを破棄するタイマー
            instance._cancel_destroy_timer = _set_timeout(
                lambda: asyncio.create_task(instance.destroy()), cls.SESSION_TIMEOUT,
            )

            cls.__instances[session_id] = instance
            logger.info(f'{instance.log_prefix} Streaming Session Started.')
        else:
            instance = cls.__instances[session_id]
            # 録画 ID / 画質 / オプションの不一致は session_id 再利用ミスとして弾く
            if (instance.video_source.id != video_source.id or instance.quality != quality
                    or instance.audio_only != audio_only):
                raise RuntimeError('Session exists but video_id or quality mismatch')
            if encoding_options is not None and instance.encoding_options != encoding_options:
                raise RuntimeError('Session exists but encoding options mismatch')

        return cls.__instances[session_id]

    def __init__(
        self,
        session_id: str,
        video_source: VideoSource,
        quality: QUALITY_TYPES,
        encoding_options: StreamEncodingOptions | None = None,
        encoder: str = 'FFmpeg',
        secondary_audio: bool = False,
        is_new_session_allowed: bool = False,
        audio_only: bool = False,
    ) -> None:
        # Singleton のため生成は __new__ で行う。型ヒントのみ定義。
        self.session_id: str
        self.video_source: VideoSource
        self.quality: QUALITY_TYPES
        self.encoding_options: StreamEncodingOptions
        self.encoder: str
        self.secondary_audio: bool
        self.audio_only: bool
        self._segment_duration_seconds: float
        self._segments: list[VideoStreamSegment]
        self._key_frames: list[KeyFrame]
        self._key_frame_dts_list: list[int]
        self._segment_map_by_sequence: dict[int, SegmentMapEntry]
        self._mp4_keyframe_dts_list: list[int] | None
        self._video_encoding_task: VideoEncodingTask
        self._video_encoding_task_lock: asyncio.Lock
        self._video_encoding_task_ref: asyncio.Task[None] | None
        self._detached_video_encoding_task_refs: set[asyncio.Task[None]]
        self._cancel_destroy_timer: Callable[[], None]

    @property
    def log_prefix(self) -> str:
        quality = 'audio' if self.audio_only else f'{self.quality}{self.encoding_options.buildSuffix()}'
        return f'[Video: {self.video_source.id}/{self.session_id}/{quality}]'

    @property
    def segments(self) -> tuple[VideoStreamSegment, ...]:
        """HLS セグメントを格納するリスト (読み取り専用)"""
        return tuple(self._segments)

    def keepAlive(self) -> None:
        """録画視聴セッションのアクティブ状態を維持する（視聴中は定期的に呼ぶ）。"""
        self._cancel_destroy_timer()
        self._cancel_destroy_timer = _set_timeout(
            lambda: asyncio.create_task(self.destroy()), self.SESSION_TIMEOUT,
        )

    def getBufferRange(self) -> tuple[float, float]:
        """エンコード完了済みの HLS セグメントのバッファ範囲 (秒) を返す。"""
        encoded_segments = [s for s in self._segments if s.encode_status == 'Completed']
        if encoded_segments:
            first_segment = encoded_segments[0]
            last_segment = encoded_segments[-1]
            return (first_segment.playlist_start_seconds,
                    last_segment.playlist_start_seconds + last_segment.duration_seconds)
        return (0, 0)

    def getVirtualPlaylist(self, cache_key: str | None = None) -> str:
        """仮想 HLS M3U8 プレイリストを取得する（セグメントは随時エンコードされる）。"""
        self.keepAlive()

        # まだ空なら、録画時間とフレームレートから仮想セグメントを作成する
        if len(self._segments) == 0:
            segment_count = max(1, math.ceil(self.video_source.duration / self._segment_duration_seconds))
            for segment_sequence in range(segment_count):
                playlist_start_seconds = segment_sequence * self._segment_duration_seconds
                remaining_duration = self.video_source.duration - playlist_start_seconds
                duration_seconds = min(self._segment_duration_seconds, max(remaining_duration, 0.001))
                self._segments.append(VideoStreamSegment(
                    sequence_index = segment_sequence,
                    playlist_start_seconds = playlist_start_seconds,
                    source_file_position = None,
                    source_start_dts = None,
                    duration_seconds = duration_seconds,
                    encode_status = 'Pending',
                    encoded_segment_ts_future = asyncio.get_event_loop().create_future(),
                ))
            logger.info(
                f'{self.log_prefix} Total {len(self._segments)} virtual segments '
                f'(segment_duration: {self._segment_duration_seconds:.6f}s).'
            )

        if cache_key is None:
            cache_key = uuid.uuid4().hex.split('-')[0]

        virtual_playlist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n'
        target_duration = max(s.duration_seconds for s in self._segments)
        virtual_playlist += f'#EXT-X-TARGETDURATION:{math.ceil(target_duration)}\n'
        for segment in self._segments:
            virtual_playlist += f'#EXTINF:{segment.duration_seconds:.6f},\n'
            virtual_playlist += (f'segment?session_id={self.session_id}'
                                 f'&sequence={segment.sequence_index}&cache_key={cache_key}\n')
        virtual_playlist += '#EXT-X-ENDLIST\n'
        return virtual_playlist

    async def resolveSegmentSourcePosition(self, segment_sequence: int) -> None:
        """指定セグメントのエンコード開始点（入力ファイル位置と DTS）を解決する。"""
        segment = self._segments[segment_sequence]
        if segment.source_start_dts is not None:
            return

        if self.video_source.container_format == 'MPEG-4':
            # MP4: moov から同期サンプル DTS を取得し、psisimux -m に渡す時刻を決める
            from pathlib import Path
            from .mp4_keyframe_parser import MP4KeyFrameParser
            if self._mp4_keyframe_dts_list is None:
                self._mp4_keyframe_dts_list = await asyncio.to_thread(
                    MP4KeyFrameParser.readVideoKeyFrameDTS,
                    Path(self.video_source.file_path),
                )
            segment.source_file_position = None  # MP4 はバイト位置不使用
            segment.source_start_dts = MP4KeyFrameParser.findKeyFrameDTSBefore(
                self._mp4_keyframe_dts_list,
                segment.playlist_start_seconds,
            )
            return

        # MPEG-TS: 1) segment_map キャッシュにあればそれを使う
        entry = self._segment_map_by_sequence.get(segment_sequence)
        if entry is not None:
            segment.source_file_position = entry['source_file_position']
            segment.source_start_dts = entry['source_start_dts']
            return

        # 2) なければ key_frames から直接、プレイリスト時刻以前で最も近いキーフレームを採用する
        if not self._key_frames:
            logger.warning(f'{self.log_prefix}[Segment {segment_sequence}] No key_frames available.')
            return
        base_dts = self._key_frames[0]['dts']
        target_dts = base_dts + round(segment.playlist_start_seconds * ts.HZ)
        index = bisect.bisect_right(self._key_frame_dts_list, target_dts) - 1
        if index < 0:
            index = 0
        key_frame = self._key_frames[index]
        segment.source_file_position = key_frame['offset']
        segment.source_start_dts = key_frame['dts']

    async def getSegment(self, segment_sequence: int) -> bytes | None:
        """エンコードされた HLS セグメントを取得する。未エンコードなら既存タスクを止めて当該位置から開始する。"""
        self.keepAlive()
        if segment_sequence < 0 or segment_sequence >= len(self._segments):
            return None

        segment = self._segments[segment_sequence]

        if segment.encode_status == 'Pending':
            async with self._video_encoding_task_lock:
                if segment.encode_status == 'Pending':
                    # シーク: 旧エンコーダーを先に止めてからソース位置を解決する
                    if self._video_encoding_task_ref is not None:
                        await self.__cancelVideoEncodingTask(should_wait_for_runner=False)
                        logger.info(
                            f'{self.log_prefix}[Segment {segment_sequence}] '
                            f'Previous Encoding Task Canceled before source position resolution.'
                        )

                    await self.resolveSegmentSourcePosition(segment_sequence)
                    encoding_start_sequence = segment_sequence

                    # QSVEncC は DTS 33bit ラップ直前から起動すると音ズレするため、少し手前から連続エンコードする
                    if (self.encoder == 'QSVEncC'
                            and self.video_source.container_format == 'MPEG-TS'
                            and self.video_source.has_video_stream_changes is False):
                        wrap_avoidance_ticks = self.DTS_WRAP_AVOIDANCE_SECONDS * ts.HZ
                        backtrack_iterations = 0
                        while encoding_start_sequence > 0:
                            backtrack_iterations += 1
                            if backtrack_iterations > self.DTS_WRAP_AVOIDANCE_MAX_BACKTRACK_SEGMENTS:
                                logger.warning(
                                    f'{self.log_prefix}[Segment {segment_sequence}] '
                                    f'QSVEncC DTS wrap avoidance reached the backtrack limit.'
                                )
                                break
                            start_segment = self._segments[encoding_start_sequence]
                            if start_segment.source_start_dts is None:
                                await self.resolveSegmentSourcePosition(encoding_start_sequence)
                                start_segment = self._segments[encoding_start_sequence]
                            assert start_segment.source_start_dts is not None
                            distance_to_wrap = ts.PCR_CYCLE - (start_segment.source_start_dts % ts.PCR_CYCLE)
                            if distance_to_wrap > wrap_avoidance_ticks:
                                break
                            encoding_start_sequence -= 1
                        if encoding_start_sequence != segment_sequence:
                            logger.info(
                                f'{self.log_prefix}[Segment {segment_sequence}] '
                                f'QSVEncC start adjusted to Segment {encoding_start_sequence} to avoid DTS wrap.'
                            )

                    # 新しいエンコードタスクを開始
                    self._video_encoding_task = VideoEncodingTask(self)
                    self._video_encoding_task_ref = asyncio.create_task(
                        self._video_encoding_task.run(encoding_start_sequence))
                    self.__registerVideoEncodingTaskRef(self._video_encoding_task_ref)
                    logger.info(f'{self.log_prefix}[Segment {encoding_start_sequence}] New Encoding Task Started.')

        encoded_segment_ts = await asyncio.shield(segment.encoded_segment_ts_future)
        segment.is_encoded_segment_ts_future_readed = True

        # 読み取り済みが MAX_READED_SEGMENTS 以上なら、一番古いセグメントを解放する
        readed_segments = [s for s in self._segments if s.is_encoded_segment_ts_future_readed]
        if len(readed_segments) >= self.MAX_READED_SEGMENTS:
            oldest_segment = readed_segments[0]
            await oldest_segment.resetState()
            logger.info(f'{self.log_prefix}[Segment {oldest_segment.sequence_index}] Reset segment data to free memory.')

        return encoded_segment_ts

    def __registerVideoEncodingTaskRef(self, video_encoding_task_ref: asyncio.Task[None]) -> None:
        def OnDone(done_task: asyncio.Task[None]) -> None:
            self._detached_video_encoding_task_refs.discard(done_task)
            if self._video_encoding_task_ref == done_task:
                self._video_encoding_task_ref = None
        video_encoding_task_ref.add_done_callback(OnDone)

    def __detachVideoEncodingTaskRef(self, video_encoding_task_ref: asyncio.Task[None]) -> None:
        if video_encoding_task_ref.done() is True:
            return
        self._detached_video_encoding_task_refs.add(video_encoding_task_ref)

    async def __cancelVideoEncodingTask(
        self,
        should_wait_for_runner: bool = True,
        timeout_seconds: float = 0.5,
    ) -> None:
        """現在のエンコードタスクをキャンセルし、必要に応じて短時間だけ終了を待機する。"""
        self._video_encoding_task.cancel()
        if self._video_encoding_task_ref is None:
            return
        encoding_task_runner = self._video_encoding_task_ref

        if should_wait_for_runner is False:
            self.__detachVideoEncodingTaskRef(encoding_task_runner)
            if self._video_encoding_task_ref == encoding_task_runner:
                self._video_encoding_task_ref = None
            return

        try:
            await asyncio.wait_for(asyncio.shield(encoding_task_runner), timeout=timeout_seconds)
        except (TimeoutError, asyncio.TimeoutError):
            self.__detachVideoEncodingTaskRef(encoding_task_runner)
            if self._video_encoding_task_ref == encoding_task_runner:
                self._video_encoding_task_ref = None
            logger.warning(f'{self.log_prefix} Encoding task shutdown timed out. Proceeding with restart.')
        except Exception as ex:
            self.__detachVideoEncodingTaskRef(encoding_task_runner)
            if self._video_encoding_task_ref == encoding_task_runner:
                self._video_encoding_task_ref = None
            logger.error(f'{self.log_prefix} Error while waiting for encoding task shutdown: {ex}')
        finally:
            if encoding_task_runner.done() and self._video_encoding_task_ref == encoding_task_runner:
                self._video_encoding_task_ref = None

    async def destroy(self) -> None:
        """実行中のエンコードなどを終了し、録画視聴セッションを破棄する。"""
        async with self._video_encoding_task_lock:
            await self.__cancelVideoEncodingTask()
        self._segments = []
        self.__instances.pop(self.session_id, None)
        logger.info(f'{self.log_prefix} Streaming Session Finished.')

    # ──────────────────────────────────────────────────────────────
    # 再生時 segment_map 収集の無効化用スタブ
    # ──────────────────────────────────────────────────────────────
    # 本実装は ingest 収集の key_frames から segment_map を起動時生成するため、
    # 再生中のオンデマンドキーフレーム収集（KonomiTV の TSKeyFrameSeeker/segment_map 永続）は行わない。
    # VideoEncodingTask は KonomiTV からほぼ verbatim でコピーしており、これらを参照するが、
    # ts_stream_info を None に保つことで収集経路は自然に無効化される（no-op）。
    @property
    def ts_stream_info(self):
        return None

    @property
    def ts_source_base_dts(self):
        return None

    async def ensureTSKeyFrameContext(self) -> None:
        return None

    def createSegmentMapEntriesFromKeyFrames(self, key_frames: list[KeyFrame]) -> list[SegmentMapEntry]:
        return []

    async def saveSegmentMapEntries(self, segment_map_entries: list[SegmentMapEntry]) -> None:
        return None

    @classmethod
    def get(cls, session_id: str) -> VideoStream | None:
        """既存セッションを取得する（存在しなければ None）。"""
        return cls.__instances.get(session_id)
