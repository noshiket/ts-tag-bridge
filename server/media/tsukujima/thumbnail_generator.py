# このファイルは KonomiTV (https://github.com/tsukumijima/KonomiTV) の
# server/app/metadata/ThumbnailGenerator.py をベースに encode_auto 向けに改変したものです。
#
# The MIT License (MIT)
# Copyright (c) 2021-2026 tsukumi
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

from __future__ import annotations

import concurrent.futures
import logging
import math
import multiprocessing
import pathlib
import random
import subprocess
import time
from typing import ClassVar, Literal, cast

import av
import cv2
import numpy as np
from numpy.typing import NDArray


logger = logging.getLogger(__name__)

_ANIME_FACE_CASCADE_PATH = pathlib.Path(__file__).parent / 'lbpcascade_animeface.xml'


# ---------------------------------------------------------------------------
# ジャンル判定ユーティリティ
# ---------------------------------------------------------------------------

def _parse_eit_genre(eit_genre_str: str) -> list[dict]:
    """'major1 > middle1, major2 > middle2' 形式を [{'major': ..., 'middle': ...}] に変換"""
    result = []
    for part in eit_genre_str.split(', '):
        pair = part.split(' > ', 1)
        major = pair[0].strip()
        middle = pair[1].strip() if len(pair) > 1 else ''
        if major:
            result.append({'major': major, 'middle': middle})
    return result


def _is_anime_genre(genre: dict) -> bool:
    major, middle = genre['major'], genre['middle']
    if major == 'アニメ・特撮' and middle != '特撮':
        return True
    if major == '映画' and middle == 'アニメ':
        return True
    return False


def _is_live_action_genre(genre: dict) -> bool:
    major, middle = genre['major'], genre['middle']
    if major in {'ニュース・報道', '情報・ワイドショー', 'ドラマ', '劇場・公演'}:
        return True
    if major == 'バラエティ' and middle != 'お笑い・コメディ':
        return True
    if major == 'アニメ・特撮' and middle == '特撮':
        return True
    if major == '映画' and middle != 'アニメ':
        return True
    if major == 'ドキュメンタリー・教養' and middle in {'社会・時事', '歴史・紀行', 'インタビュー・討論'}:
        return True
    return False


def _determine_face_detection_mode(genres: list[dict]) -> Literal['Human', 'Anime'] | None:
    if not genres:
        return None
    has_anime = any(_is_anime_genre(g) for g in genres)
    if has_anime and not any(_is_live_action_genre(g) for g in genres):
        return 'Anime'
    if any(_is_live_action_genre(g) for g in genres):
        return 'Human'
    return None


def _display_aspect(path: pathlib.Path) -> float | None:
    """表示の縦横比（幅 × 画素の縦横比 ÷ 高さ）。読めない時は None"""
    try:
        with av.open(str(path)) as c:
            if not c.streams.video:
                return None
            cc = c.streams.video[0].codec_context
            sar = cc.sample_aspect_ratio
            if not cc.width or not cc.height:
                return None
            return cc.width * (float(sar) if sar else 1.0) / cc.height
    except Exception:
        return None


def _fit_aspect(base: tuple[int, int], aspect: float) -> tuple[int, int]:
    """16:9 の大きさ base を、短い辺はそのままで aspect の比率にする（偶数に丸める）"""
    short = base[1]
    if aspect < 1:
        return short, int(round(short / aspect / 2)) * 2
    return int(round(short * aspect / 2)) * 2, short


# ---------------------------------------------------------------------------
# ThumbnailGenerator
# ---------------------------------------------------------------------------

class ThumbnailGenerator:
    """
    プレイヤーのシークバー用タイル画像と、候補区間内で最も良い1枚の代表サムネイルを生成するクラス
    """

    BASE_DURATION_MIN: ClassVar[int] = 30
    BASE_INTERVAL_SEC: ClassVar[float] = 5.0
    MAX_INTERVAL_SEC: ClassVar[float] = 30.0
    SCORING_SCALE: tuple[int, int] = (480, 270)   # 16:9 以外の動画は __init__ で元の比率にする
    TILE_SCALE: tuple[int, int] = (320, 180)

    WEBP_QUALITY_REPRESENTATIVE: ClassVar[int] = 80
    WEBP_QUALITY_TILE: ClassVar[int] = 71
    WEBP_COMPRESSION: ClassVar[int] = 6
    WEBP_MAX_SIZE: ClassVar[int] = 16383
    # タイル画像の横幅の上限。WEBP_MAX_SIZE(フォーマット仕様上の最大値)いっぱいまで
    # 敷き詰めると 16320px になり、デスクトップの Chrome/Safari はデコードできるが
    # iOS(WKWebView の WebP デコーダ)はこれより低い実用上の上限を持っており、
    # 幅16320pxのタイルは常にデコード失敗する(makeImagePlus: err=-50)。
    # 行数(高さ方向)は WEBP_MAX_SIZE のままで足りるため、そちらは変えない。
    WEBP_MAX_TILE_ROW_WIDTH: ClassVar[int] = 8192
    FFMPEG_TIMEOUT: ClassVar[int] = 300
    # フレーム抽出の上限。多プログラム/キーフレーム希薄なTSでは「シーク→次のIフレーム」が
    # 1枚あたり数十秒×数百枚=数時間かかり得るため、1枚毎と全体の両方で打ち切る
    # (超過分は黒フレームで埋める。録画の走査を長時間ブロックしないための安全弁)。
    EXTRACT_FRAME_TIMEOUT_SEC: ClassVar[float] = 10.0
    EXTRACT_TOTAL_BUDGET_SEC: ClassVar[float] = 600.0

    HUMAN_FACE_CASCADE_PATH: ClassVar[pathlib.Path] = (
        pathlib.Path(cv2.__file__).parent / 'data' / 'haarcascade_frontalface_default.xml'
    )
    ANIME_FACE_CASCADE_PATH: ClassVar[pathlib.Path] = _ANIME_FACE_CASCADE_PATH

    HUMAN_FACE_DETECTION_SCALE_FACTOR: ClassVar[float] = 1.05
    HUMAN_FACE_DETECTION_MIN_NEIGHBORS: ClassVar[int] = 3
    ANIME_FACE_DETECTION_SCALE_FACTOR: ClassVar[float] = 1.01
    ANIME_FACE_DETECTION_MIN_NEIGHBORS: ClassVar[int] = 2
    NON_ANIME_FACE_DETECTION_SCALE_FACTOR: ClassVar[float] = 1.10
    NON_ANIME_FACE_DETECTION_MIN_NEIGHBORS: ClassVar[int] = 5
    HUMAN_FACE_SIZE_WEIGHT: ClassVar[float] = 1.5
    ANIME_FACE_SIZE_WEIGHT: ClassVar[float] = 8.0
    FACE_SIZE_BASE_SCORE: ClassVar[float] = 20.0
    ANIME_FACE_OPTIMAL_RATIO: ClassVar[float] = 0.23
    ANIME_FACE_RATIO_FALLOFF: ClassVar[float] = 0.6

    LETTERBOX_MIN_HEIGHT_RATIO: ClassVar[float] = 0.05
    LETTERBOX_MAX_HEIGHT_RATIO: ClassVar[float] = 0.25
    LETTERBOX_AREA_THRESHOLD: ClassVar[float] = 0.4
    LETTERBOX_LUMINANCE_THRESHOLD: ClassVar[int] = 45
    LETTERBOX_CONTINUOUS_RATIO: ClassVar[float] = 0.7
    LETTERBOX_EDGE_THRESHOLD: ClassVar[float] = 0.05

    SCORE_WEIGHTS: ClassVar[dict[str, float]] = {
        'std_lum': 0.6,
        'contrast': 0.4,
        'sharpness': 0.5,
        'edge_density': 0.4,
        'entropy': 0.3,
    }
    ANIME_SCORE_WEIGHTS: ClassVar[dict[str, float]] = {
        'std_lum': 0.4,
        'contrast': 0.3,
        'sharpness': 0.15,
        'edge_density': 0.2,
        'entropy': 0.4,
    }

    BRIGHTNESS_PENALTY_THRESHOLD: ClassVar[tuple[int, int]] = (20, 235)
    BRIGHTNESS_PENALTY_VALUE: ClassVar[float] = 20.0
    CONTRAST_PERCENTILE_LOW: ClassVar[int] = 5
    CONTRAST_PERCENTILE_HIGH: ClassVar[int] = 95
    EDGE_DENSITY_TARGET: ClassVar[float] = 0.15
    EDGE_DENSITY_TOLERANCE: ClassVar[float] = 0.1
    ENTROPY_TARGET: ClassVar[float] = 5.0
    ENTROPY_TOLERANCE: ClassVar[float] = 2.0

    COLOR_VARIANCE_THRESHOLD: ClassVar[float] = 10.0
    BLACK_THRESHOLD: ClassVar[int] = 30
    WHITE_THRESHOLD: ClassVar[int] = 225
    SOLID_COLOR_PENALTY: ClassVar[float] = 100.0

    EDGE_MARGIN_RATIO: ClassVar[float] = 0.08
    EDGE_CONTACT_THRESHOLD: ClassVar[float] = 0.6
    MIN_EDGES_REQUIRED: ClassVar[int] = 2
    EDGE_COLOR_RANGE: ClassVar[float] = 30.0
    EDGE_BORDER_PENALTY: ClassVar[float] = 90.0
    EDGE_LUMINANCE_THRESHOLD: ClassVar[float] = 30.0
    EDGE_CONTINUOUS_RATIO: ClassVar[float] = 0.8
    EDGE_DARK_RATIO_THRESHOLD: ClassVar[float] = 0.85

    LETTERBOX_PENALTY: ClassVar[float] = 50.0

    COLOR_BALANCE_K: ClassVar[int] = 3
    COLOR_BALANCE_WEIGHT: ClassVar[float] = 0.5
    COLOR_BALANCE_MIN_RATIO: ClassVar[float] = 0.15
    COLOR_BALANCE_MAX_RATIO: ClassVar[float] = 0.7
    COLOR_BALANCE_MIN_DISTANCE: ClassVar[float] = 30.0


    def __init__(
        self,
        file_path: pathlib.Path,
        duration_sec: float,
        candidate_time_ranges: list[tuple[float, float]],
        ffmpeg_path: str,
        face_detection_mode: Literal['Human', 'Anime'] | None = None,
        video_pid: int | None = None,
    ) -> None:
        self.file_path = file_path
        self.duration_sec = duration_sec
        self.candidate_intervals = candidate_time_ranges
        self.face_detection_mode = face_detection_mode
        self.ffmpeg_path = ffmpeg_path
        # 多プログラムTS: 対象映像ストリームのPID(録画取込走査の選択結果)。
        # 指定時はPyAVのstream[0]でなくこのPIDのストリームからフレーム抽出する
        self.video_pid = video_pid
        # 16:9 以外の動画（スマホで撮った縦長・4:3 など）は、代表サムネとタイルのコマも元の比率にする
        # （16:9 の大きさのままだと歪んだ）。放送の 1440×1080 は画素が横長なので表示は 16:9 のまま。
        # 録画の TS は from_recording で後から差し替えるので 16:9 のまま
        aspect = _display_aspect(file_path)
        if aspect and abs(aspect - 16 / 9) > 0.02:
            self.SCORING_SCALE = _fit_aspect(self.SCORING_SCALE, aspect)
            self.TILE_SCALE = _fit_aspect(self.TILE_SCALE, aspect)

        self.base_tile_interval_sec = self.__calculateBaseTileInterval(duration_sec)
        (
            self.tile_interval_sec,
            self.tile_cols,
            self.tile_rows,
            self.total_tiles,
            self.tile_image_width,
            self.tile_image_height,
        ) = self.__calculateTileLayout()

        stem = file_path.stem
        self.representative_thumbnail_path = file_path.parent / f'{stem}.thumbnail.webp'
        self.seekbar_thumbnails_tile_path = file_path.parent / f'{stem}.thumbnail_tile.webp'


    @classmethod
    def from_recording(
        cls,
        recording_id: int,
        ts_path: str,
        duration_sec: float,
        eit_genre_str: str,
        ffmpeg_path: str,
        thumbnails_dir: pathlib.Path,
        video_pid: int | None = None,
    ) -> 'ThumbnailGenerator':
        """
        録画 TS ファイルから ThumbnailGenerator を初期化する

        コンストラクタに thumbnails_dir / recording_id を渡すことで出力パスを設定し、
        その後 file_path を TS ファイルのパスに上書きする。
        """
        genres = _parse_eit_genre(eit_genre_str)
        face_detection_mode = _determine_face_detection_mode(genres)
        gen = cls(
            file_path=thumbnails_dir / str(recording_id),
            duration_sec=duration_sec,
            candidate_time_ranges=[(duration_sec * 0.25, duration_sec * 0.70)],
            ffmpeg_path=ffmpeg_path,
            face_detection_mode=face_detection_mode,
            video_pid=video_pid,
        )
        gen.file_path = pathlib.Path(ts_path)
        return gen


    @classmethod
    def from_encoding(
        cls,
        encoded_path: str,
        duration_sec: float,
        trim_segments: list[dict],
        eit_genre_str: str,
        ffmpeg_path: str,
    ) -> ThumbnailGenerator:
        """
        エンコード済みファイルから ThumbnailGenerator を初期化する

        Args:
            encoded_path: エンコード済みファイルのパス
            duration_sec: 動画の長さ (秒)
            trim_segments: CM 除き済みセグメント [{'duration_sec': float, ...}, ...]
            eit_genre_str: recordings.eit_genre ('major > middle, ...' 形式)
            ffmpeg_path: FFmpeg バイナリのパス
        """
        genres = _parse_eit_genre(eit_genre_str)
        face_detection_mode = _determine_face_detection_mode(genres)

        # trim_segments の各区間を encoded video 上の累積オフセットに変換して候補区間を生成
        candidate_time_ranges = []
        cumulative = 0.0
        for seg in trim_segments:
            seg_dur = float(seg.get('duration_sec', 0))
            if seg_dur > 10:
                candidate_time_ranges.append((
                    cumulative + seg_dur * 0.4,
                    cumulative + seg_dur * 0.6,
                ))
            cumulative += seg_dur
        # trim_segments が空または全区間が短すぎる場合は動画全体の 25~70% をフォールバック
        if not candidate_time_ranges:
            candidate_time_ranges = [(duration_sec * 0.25, duration_sec * 0.70)]

        return cls(
            file_path=pathlib.Path(encoded_path),
            duration_sec=duration_sec,
            candidate_time_ranges=candidate_time_ranges,
            ffmpeg_path=ffmpeg_path,
            face_detection_mode=face_detection_mode,
        )


    def generate_and_save(self) -> tuple[str | None, str | None]:
        """
        サムネイルを生成し (thumbnail_path, tile_path) を返す。
        失敗時は (None, None)。
        """
        start_time = time.time()
        logger.info('%s: Generating thumbnail... Face detection mode: %s',
                    self.file_path, self.face_detection_mode)

        try:
            self.representative_thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

            candidate_offsets = self.__calculateCandidateOffsets()

            # fork だとサーバー本体（マルチスレッド＋リッスンソケット fd）をそのまま複製してしまい、
            # 子が :8092 を握ったまま見える等の副作用がある。spawn で独立した子を起動する。
            with concurrent.futures.ProcessPoolExecutor(
                max_workers=1, mp_context=multiprocessing.get_context('spawn')
            ) as executor:
                future = executor.submit(
                    self._generateAndSaveThumbnails,
                    candidate_offsets,
                    self.tile_rows,
                )
                success = future.result()

            if not success:
                logger.error('%s: Failed to generate thumbnails in subprocess.', self.file_path)
                return (None, None)

            logger.info('%s: Thumbnail generation completed. (%.2f sec)',
                        self.file_path, time.time() - start_time)

            thumbnail_path = (
                str(self.representative_thumbnail_path)
                if self.representative_thumbnail_path.is_file() else None
            )
            tile_path = (
                str(self.seekbar_thumbnails_tile_path)
                if self.seekbar_thumbnails_tile_path.is_file() else None
            )
            return (thumbnail_path, tile_path)

        except Exception:
            logger.exception('%s: Unexpected error in thumbnail generation:', self.file_path)
            return (None, None)


    def build_thumbnail_info(self, tile_path: str | None) -> dict:
        """generate_and_save() 後に呼び出して thumbnail_info dict を組み立てる。"""
        info: dict = {
            'representative': {
                'format': 'WebP',
                'width': self.SCORING_SCALE[0],
                'height': self.SCORING_SCALE[1],
            }
        }
        if tile_path:
            info['tile'] = {
                'format': 'WebP',
                'image_width': self.tile_image_width,
                'image_height': self.tile_image_height,
                'tile_width': self.TILE_SCALE[0],
                'tile_height': self.TILE_SCALE[1],
                'total_tiles': self.total_tiles,
                'column_count': self.tile_cols,
                'row_count': self.tile_rows,
                'interval_sec': self.tile_interval_sec,
            }
        return info


    def __calculateBaseTileInterval(self, duration_sec: float) -> float:
        duration_min = int(duration_sec / 60)
        if duration_min <= self.BASE_DURATION_MIN:
            return self.BASE_INTERVAL_SEC
        duration_ratio = duration_min / self.BASE_DURATION_MIN
        return min(
            self.MAX_INTERVAL_SEC,
            round(self.BASE_INTERVAL_SEC * duration_ratio / math.log2(1 + duration_ratio / 2), 1),
        )


    def __calculateTileLayout(self) -> tuple[float, int, int, int, int, int]:
        tile_width, tile_height = self.TILE_SCALE
        # 列数は 16:9 のコマの時の上限（25）まで（比率が違っても iOS 向けの詰め直しと画面の計算
        # REFLOWED_MAX_COLUMNS がずれないように）。横に長いコマはさらに幅の上限で減らす
        max_cols = max(1, min(self.WEBP_MAX_TILE_ROW_WIDTH // 320, self.WEBP_MAX_TILE_ROW_WIDTH // tile_width))
        max_rows = max(1, self.WEBP_MAX_SIZE // tile_height)
        max_tiles = max_cols * max_rows

        expected_tiles = math.ceil(self.duration_sec / self.base_tile_interval_sec)
        if expected_tiles > max_tiles:
            adjusted_interval = math.ceil((self.duration_sec / max_tiles) * 10) / 10
            tile_interval_sec = max(self.base_tile_interval_sec, adjusted_interval)
            logger.warning('%s: Tile count exceeds WebP limit. Adjusting interval to %.1f sec.',
                           self.file_path, tile_interval_sec)
        else:
            tile_interval_sec = self.base_tile_interval_sec

        total_tiles = math.ceil(self.duration_sec / tile_interval_sec)
        if total_tiles < 1:
            total_tiles = 1
        tile_rows = math.ceil(total_tiles / max_cols)
        if tile_rows > max_rows:
            total_tiles = max_cols * max_rows
            tile_interval_sec = math.ceil((self.duration_sec / total_tiles) * 10) / 10
            tile_rows = max_rows
            logger.warning('%s: Tile rows still exceed WebP limit. Adjusting interval to %.1f sec.',
                           self.file_path, tile_interval_sec)

        tile_cols = max_cols
        tile_image_width = tile_width * tile_cols
        tile_image_height = tile_height * tile_rows

        return (tile_interval_sec, tile_cols, tile_rows, total_tiles, tile_image_width, tile_image_height)


    def __calculateCandidateOffsets(self) -> list[float]:
        candidate_offsets: list[float] = []
        for i in range(self.total_tiles):
            offset = i * self.tile_interval_sec
            if offset + 0.01 > self.duration_sec:
                offset = max(0, self.duration_sec - 0.02)
            candidate_offsets.append(offset)
        return candidate_offsets


    def _generateAndSaveThumbnails(
        self,
        candidate_offsets: list[float],
        tile_rows: int,
    ) -> bool:
        """ProcessPoolExecutor で実行されるエントリーポイント"""
        result = self.__extractAndScoreFrames(candidate_offsets)
        if result is None:
            logger.error('%s: Failed to extract and score frames.', self.file_path)
            return False

        all_frames, best_frame_index = result
        if len(all_frames) == 0:
            logger.error('%s: No frames extracted at all.', self.file_path)
            return False

        # 代表サムネイルを保存
        start_repr = time.time()
        if best_frame_index is not None:
            best_frame = all_frames[best_frame_index]
        else:
            logger.warning('%s: No frames found in candidate intervals. Selecting a random frame.',
                           self.file_path)
            best_frame = random.choice(all_frames)

        if not self.__saveRepresentativeThumbnail(best_frame):
            logger.error('%s: Failed to save representative thumbnail.', self.file_path)
            return False
        logger.info('%s: Representative thumbnail saved. (%.2f sec)',
                    self.file_path, time.time() - start_repr)

        # タイル画像を生成・保存
        start_tile = time.time()
        if not self.__generateAndSaveTileImage(all_frames, tile_rows):
            logger.error('%s: Failed to generate and save tile image.', self.file_path)
            return False
        logger.info('%s: Tile image generation completed. (%.2f sec)',
                    self.file_path, time.time() - start_tile)
        return True


    def __extractAndScoreFrames(
        self,
        candidate_offsets: list[float],
    ) -> tuple[list[NDArray[np.uint8]], int | None] | None:
        try:
            start_extract = time.time()
            scoring_width, scoring_height = self.SCORING_SCALE
            bgr_frames: list[NDArray[np.uint8]] = []

            container = av.open(str(self.file_path))
            if len(container.streams.video) == 0:
                logger.error('%s: No video stream found.', self.file_path)
                raise ValueError('No video stream found.')
            # 多プログラムTS: 指定PID(録画取込走査が選んだ対象ストリーム)を優先。
            # PyAVのStream.idはMPEG-TSのPID。無指定/不一致は従来どおり先頭。
            video_stream = container.streams.video[0]
            _vpid = getattr(self, 'video_pid', None)  # 旧コードでpickleされた場合に属性が無い
            if _vpid is not None:
                for vs in container.streams.video:
                    if vs.id == _vpid:
                        video_stream = vs
                        break

            try:
                video_stream.codec_context.skip_frame = 'NONINTRA'

                for i, offset_sec in enumerate(candidate_offsets):
                    # 全体バジェット超過: 残りは黒フレームで埋めて打ち切る
                    if time.time() - start_extract > self.EXTRACT_TOTAL_BUDGET_SEC:
                        logger.warning('%s: frame extraction exceeded total budget (%.0fs) at %d/%d. '
                                       'Filling the rest with black frames.',
                                       self.file_path, self.EXTRACT_TOTAL_BUDGET_SEC,
                                       i, len(candidate_offsets))
                        while len(bgr_frames) < len(candidate_offsets):
                            bgr_frames.append(np.zeros((scoring_height, scoring_width, 3), dtype=np.uint8))
                        break
                    try:
                        if video_stream.time_base is None:
                            time_base = 1 / 90000
                            logger.warning('%s: time_base is None, using fallback: %s',
                                           self.file_path, time_base)
                        else:
                            time_base = float(video_stream.time_base)
                        start_time_pts = video_stream.start_time if video_stream.start_time else 0
                        target_ts = int(start_time_pts + offset_sec / time_base)
                        container.seek(target_ts, backward=True, any_frame=False, stream=video_stream)
                        video_stream.codec_context.flush_buffers()

                        # 1枚毎のデコード上限。キーフレーム希薄なストリームでは次のIフレーム
                        # まで何分もdemuxし続けるため、時間で打ち切って黒フレームへ落とす
                        frame: av.VideoFrame | None = None
                        frame_deadline = time.time() + self.EXTRACT_FRAME_TIMEOUT_SEC
                        for packet in container.demux(video_stream):
                            if time.time() > frame_deadline:
                                logger.warning('%s: frame extraction at %.2fs timed out (%.0fs).',
                                               self.file_path, offset_sec, self.EXTRACT_FRAME_TIMEOUT_SEC)
                                break
                            for decoded_frame in packet.decode():
                                frame = cast(av.VideoFrame, decoded_frame)
                                break
                            if frame is not None:
                                break

                        if frame is None:
                            logger.warning('%s: Failed to extract frame at %.2fs. Using black image.',
                                           self.file_path, offset_sec)
                            bgr_frames.append(np.zeros((scoring_height, scoring_width, 3), dtype=np.uint8))
                            continue

                        img_rgb = frame.to_ndarray(format='rgb24')
                        img_resized = cv2.resize(img_rgb, (scoring_width, scoring_height),
                                                 interpolation=cv2.INTER_AREA)
                        bgr_frames.append(cast(NDArray[np.uint8], cv2.cvtColor(img_resized, cv2.COLOR_RGB2BGR)))

                        if (i + 1) % 50 == 0:
                            logger.debug('%s: Extracted %d/%d frames', self.file_path, i + 1, len(candidate_offsets))

                    except Exception:
                        logger.warning('%s: Error extracting frame at %.2fs.',
                                       self.file_path, offset_sec, exc_info=True)
                        bgr_frames.append(np.zeros((scoring_height, scoring_width, 3), dtype=np.uint8))
                        try:
                            container.close()
                        except Exception:
                            pass
                        try:
                            container = av.open(str(self.file_path))
                            video_stream = container.streams.video[0]
                            if _vpid is not None:
                                for vs in container.streams.video:
                                    if vs.id == _vpid:
                                        video_stream = vs
                                        break
                            video_stream.codec_context.skip_frame = 'NONINTRA'
                        except Exception:
                            logger.error('%s: Failed to reopen container after error.', self.file_path,
                                         exc_info=True)
                            return None
            finally:
                container.close()

            logger.info('%s: All %d frames extracted. (%.2f sec)',
                        self.file_path, len(bgr_frames), time.time() - start_extract)

            # スコアリング
            start_scoring = time.time()

            face_cascade = None
            auxiliary_face_cascade = None
            if self.face_detection_mode == 'Human':
                face_cascade = cv2.CascadeClassifier(str(self.HUMAN_FACE_CASCADE_PATH))
            elif self.face_detection_mode == 'Anime':
                face_cascade = cv2.CascadeClassifier(str(self.ANIME_FACE_CASCADE_PATH))
                auxiliary_face_cascade = cv2.CascadeClassifier(str(self.HUMAN_FACE_CASCADE_PATH))

            scored_frames: list[tuple[int, float, bool]] = []
            total_frames = len(bgr_frames)
            cols = self.tile_cols
            for idx in range(total_frames):
                time_offset = idx * self.tile_interval_sec
                if not self.__inCandidateIntervals(time_offset):
                    continue
                row = idx // cols + 1
                col = idx % cols + 1
                score, found_face = self.__computeImageScore(
                    bgr_frames[idx], face_cascade, auxiliary_face_cascade, row, col)
                scored_frames.append((idx, score, found_face))

            best_frame_index: int | None = None
            if scored_frames:
                face_frames = [(idx, sc, True) for (idx, sc, f) in scored_frames if f]
                if self.face_detection_mode is not None and face_frames:
                    best_idx, _, _ = max(face_frames, key=lambda x: x[1])
                    logger.debug('Best frame selected (face found / row:%d, col:%d)',
                                 best_idx // cols + 1, best_idx % cols + 1)
                    best_frame_index = best_idx
                else:
                    best_idx, _, _ = max(scored_frames, key=lambda x: x[1])
                    logger.debug('Best frame selected (face not found / row:%d, col:%d)',
                                 best_idx // cols + 1, best_idx % cols + 1)
                    best_frame_index = best_idx
            else:
                logger.warning('%s: No frames found in candidate intervals.', self.file_path)

            logger.info('%s: Frame scoring completed. (%.2f sec)',
                        self.file_path, time.time() - start_scoring)
            return (bgr_frames, best_frame_index)

        except Exception:
            logger.error('%s: Error in frame extraction and scoring:', self.file_path, exc_info=True)
            return None


    def __saveRepresentativeThumbnail(self, img_bgr: NDArray[np.uint8]) -> bool:
        try:
            self.representative_thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
            if not cv2.imwrite(str(self.representative_thumbnail_path), img_bgr, [
                cv2.IMWRITE_WEBP_QUALITY, self.WEBP_QUALITY_REPRESENTATIVE,
            ]):
                logger.error('%s: Failed to write representative thumbnail.', self.file_path)
                return False
            return True
        except Exception:
            logger.error('%s: Error saving representative thumbnail:', self.file_path, exc_info=True)
            return False


    def __generateAndSaveTileImage(
        self,
        bgr_frames: list[NDArray[np.uint8]],
        tile_rows: int,
    ) -> bool:
        try:
            tile_width, tile_height = self.TILE_SCALE
            scoring_width, scoring_height = self.SCORING_SCALE

            if (tile_width, tile_height) != (scoring_width, scoring_height):
                resized_frames = [
                    self.downscaleWithAntiMoire(frame, tile_width, tile_height)
                    for frame in bgr_frames
                ]
            else:
                resized_frames = bgr_frames

            rows = []
            num_cols = self.tile_cols
            for r in range(tile_rows):
                row_images = list(resized_frames[r * num_cols: (r + 1) * num_cols])
                if len(row_images) < num_cols:
                    black = np.zeros((tile_height, tile_width, 3), dtype=np.uint8)
                    while len(row_images) < num_cols:
                        row_images.append(black)
                rows.append(cv2.hconcat(row_images))
            tile_image = cast(NDArray[np.uint8], cv2.vconcat(rows))

            return self.__encodeTileImageToWebP(tile_image, self.seekbar_thumbnails_tile_path)

        except Exception:
            logger.error('%s: Error in tile image generation:', self.file_path, exc_info=True)
            return False


    def downscaleWithAntiMoire(
        self,
        bgr: NDArray[np.uint8],
        out_width: int,
        out_height: int,
        pre_lp_sigma: float = 0.50,
        chroma_sigma: float = 1.0,
        unsharp_sigma: float = 0.8,
        unsharp_amount: float = 0.28,
    ) -> NDArray[np.uint8]:
        in_height, in_width = bgr.shape[:2]
        scale_x = out_width / max(1, in_width)
        scale_y = out_height / max(1, in_height)
        scale = float(np.clip(min(scale_x, scale_y), 0.05, 1.0))
        pre_lp_sigma_scaled = float(np.clip(pre_lp_sigma + (1.0 - scale) * 0.35, 0.35, 0.95))
        unsharp_amount_scaled = float(np.clip(unsharp_amount + (1.0 - scale) * 0.20, 0.20, 0.55))
        unsharp_sigma_scaled = float(np.clip(unsharp_sigma + (1.0 - scale) * 0.15, 0.7, 1.1))

        use_two_step = scale < 0.72
        mid_width, mid_height = out_width, out_height
        if use_two_step:
            mid_scale = (scale + 1.0) / 2.0
            mid_width = round(in_width * mid_scale)
            mid_height = round(in_height * mid_scale)
            if mid_width <= out_width or mid_height <= out_height:
                use_two_step = False

        ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = cv2.split(ycc)
        y_lp = cv2.GaussianBlur(y, (0, 0), sigmaX=pre_lp_sigma_scaled)

        if use_two_step:
            y_mid = cv2.resize(y_lp, (mid_width, mid_height), interpolation=cv2.INTER_AREA)
            cr_mid = cv2.resize(cr, (mid_width, mid_height), interpolation=cv2.INTER_AREA)
            cb_mid = cv2.resize(cb, (mid_width, mid_height), interpolation=cv2.INTER_AREA)
            y_s = cv2.resize(y_mid, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)
            cr_s = cv2.resize(cr_mid, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)
            cb_s = cv2.resize(cb_mid, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)
        else:
            y_s = cv2.resize(y_lp, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)
            cr_s = cv2.resize(cr, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)
            cb_s = cv2.resize(cb, (out_width, out_height), interpolation=cv2.INTER_LANCZOS4)

        cr_bl = cv2.GaussianBlur(cr_s, (0, 0), sigmaX=chroma_sigma)
        cb_bl = cv2.GaussianBlur(cb_s, (0, 0), sigmaX=chroma_sigma)
        score = cv2.absdiff(cr_s, cr_bl).astype(np.uint16) + cv2.absdiff(cb_s, cb_bl).astype(np.uint16)
        threshold = 10 if scale < 0.6 else 12
        mask = (score > threshold).astype(np.uint8) * 255
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
        mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=1.0).astype(np.float32) / 255.0

        cr_strong = cv2.GaussianBlur(cr_s, (0, 0), sigmaX=chroma_sigma * 1.6)
        cb_strong = cv2.GaussianBlur(cb_s, (0, 0), sigmaX=chroma_sigma * 1.6)
        cr2 = (cr_s.astype(np.float32) * (1 - mask) + cr_strong.astype(np.float32) * mask).astype(np.uint8)
        cb2 = (cb_s.astype(np.float32) * (1 - mask) + cb_strong.astype(np.float32) * mask).astype(np.uint8)

        y_bl = cv2.GaussianBlur(y_s, (0, 0), sigmaX=unsharp_sigma_scaled)
        detail = (y_s.astype(np.float32) - y_bl.astype(np.float32))
        sobel_x = cv2.Sobel(y_s.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(y_s.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
        edge_mag = cv2.magnitude(sobel_x, sobel_y)
        edge_mag_array = np.asarray(edge_mag, dtype=np.float32)
        edge_ref = float(np.percentile(edge_mag_array, 95))
        if edge_ref < 1.0:
            edge_ref = 1.0
        edge_norm = cast(NDArray[np.float32], np.clip(edge_mag_array / edge_ref, 0.0, 1.0))
        edge_mask = cast(NDArray[np.float32], np.clip((edge_norm - 0.05) / 0.20, 0.0, 1.0))
        edge_mask = cast(NDArray[np.float32], cv2.GaussianBlur(edge_mask, (0, 0), sigmaX=0.3))

        moire_suppress = 1.0 - 0.40 * mask
        edge_boost = 0.34 + 1.45 * edge_mask
        base_amount = unsharp_amount_scaled * 0.34
        amount_local = (unsharp_amount_scaled * edge_boost + base_amount) * moire_suppress
        y2 = np.clip(y_s.astype(np.float32) + detail * amount_local, 0, 255).astype(np.uint8)

        out = cv2.merge([y2, cr2, cb2])
        return cast(NDArray[np.uint8], cv2.cvtColor(out, cv2.COLOR_YCrCb2BGR))


    def __encodeTileImageToWebP(
        self,
        tile_image: NDArray[np.uint8],
        output_path: pathlib.Path,
    ) -> bool:
        _, tile_png_data = cv2.imencode('.png', tile_image)
        if tile_png_data is None:
            logger.error('%s: Failed to encode tile image as PNG.', self.file_path)
            return False

        preset = 'drawing' if self.face_detection_mode == 'Anime' else 'picture'
        process = subprocess.Popen(
            [
                self.ffmpeg_path,
                '-y', '-nostdin',
                '-f', 'image2pipe',
                '-codec:v', 'png',
                '-i', 'pipe:0',
                '-codec:v', 'webp',
                '-quality', str(self.WEBP_QUALITY_TILE),
                '-compression_level', str(self.WEBP_COMPRESSION),
                '-preset', preset,
                '-threads', 'auto',
                '-f', 'webp',
                str(output_path),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            _, stderr_data = process.communicate(
                input=tile_png_data.tobytes(), timeout=self.FFMPEG_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            logger.error('%s: FFmpeg tile compression timed out after %d seconds.',
                         self.file_path, self.FFMPEG_TIMEOUT)
            return False

        if process.returncode != 0:
            logger.error('%s: FFmpeg tile compression failed: %s',
                         self.file_path, stderr_data.decode('utf-8', errors='ignore'))
            return False

        return True


    def __inCandidateIntervals(self, sec: float) -> bool:
        for (start, end) in self.candidate_intervals:
            if start <= sec <= end:
                return True
        return False


    def __detectLetterbox(self, img_bgr: NDArray[np.uint8]) -> tuple[slice, slice] | None:
        height, width = img_bgr.shape[:2]
        min_height = int(height * self.LETTERBOX_MIN_HEIGHT_RATIO)
        max_height = int(height * self.LETTERBOX_MAX_HEIGHT_RATIO)

        def CheckLetterboxRegion(
            img_slice: NDArray[np.uint8],
            width: int,
            is_vertical: bool = True,
        ) -> tuple[bool, int]:
            gray = cv2.cvtColor(img_slice, cv2.COLOR_BGR2GRAY)
            if is_vertical:
                luminance = np.asarray(gray[:width]).mean(axis=1, dtype=np.float32)
            else:
                luminance = np.asarray(gray[:, :width]).mean(axis=0, dtype=np.float32)
            dark_ratio = np.sum(luminance <= self.LETTERBOX_LUMINANCE_THRESHOLD) / len(luminance)
            edges = cv2.Canny(gray, 50, 150)
            if is_vertical:
                edge_density = np.sum(edges[:width]) / (width * edges.shape[1])
            else:
                edge_density = np.sum(edges[:, :width]) / (width * edges.shape[0])
            if dark_ratio >= self.LETTERBOX_CONTINUOUS_RATIO and edge_density <= self.LETTERBOX_EDGE_THRESHOLD:
                return True, width
            if width > min_height * 2:
                return CheckLetterboxRegion(img_slice, width // 2, is_vertical)
            return False, 0

        top_border = 0
        bottom_border = height
        is_lb, top_w = CheckLetterboxRegion(img_bgr[:max_height], max_height, is_vertical=True)
        if is_lb:
            top_border = top_w
        is_lb, bot_w = CheckLetterboxRegion(img_bgr[height - max_height:], max_height, is_vertical=True)
        if is_lb:
            bottom_border = height - bot_w

        left_border = 0
        right_border = width
        is_lb, left_w = CheckLetterboxRegion(img_bgr[:, :max_height], max_height, is_vertical=False)
        if is_lb:
            left_border = left_w
        is_lb, right_w = CheckLetterboxRegion(img_bgr[:, width - max_height:], max_height, is_vertical=False)
        if is_lb:
            right_border = width - right_w

        total_area = height * width
        valid_area = (bottom_border - top_border) * (right_border - left_border)
        letterbox_ratio = 1.0 - (valid_area / total_area)
        if letterbox_ratio > self.LETTERBOX_AREA_THRESHOLD:
            return None
        return (slice(top_border, bottom_border), slice(left_border, right_border))


    def __checkEdgeRegion(
        self,
        img_slice: NDArray[np.uint8],
        is_vertical: bool = True,
        is_dark: bool = True,
    ) -> tuple[bool, float]:
        gray = cv2.cvtColor(img_slice, cv2.COLOR_BGR2GRAY)
        if is_dark:
            mask = gray <= self.EDGE_LUMINANCE_THRESHOLD
        else:
            mask = gray >= self.WHITE_THRESHOLD
        if is_vertical:
            ratios = np.mean(mask, axis=1)
        else:
            ratios = np.mean(mask, axis=0)
        continuous = np.sum(ratios >= self.EDGE_CONTINUOUS_RATIO)
        total_lines = ratios.shape[0]
        ratio = continuous / total_lines
        return ratio >= self.EDGE_DARK_RATIO_THRESHOLD, ratio


    def __detectEdgeBorderIssues(self, img_bgr: NDArray[np.uint8]) -> tuple[float, str]:
        height, width = img_bgr.shape[:2]
        edge_margin_h = int(height * self.EDGE_MARGIN_RATIO)
        edge_margin_w = int(width * self.EDGE_MARGIN_RATIO)

        edges = {
            'top':    img_bgr[:edge_margin_h, :],
            'bottom': img_bgr[-edge_margin_h:, :],
            'left':   img_bgr[:, :edge_margin_w],
            'right':  img_bgr[:, -edge_margin_w:],
        }

        affected_edges = []
        total_penalty = 0.0
        edge_ratios = []
        edge_types = []

        for edge_name, edge_region in edges.items():
            is_vertical = edge_name in ['top', 'bottom']
            is_dark_edge, dark_ratio = self.__checkEdgeRegion(edge_region, is_vertical, is_dark=True)
            is_bright_edge, bright_ratio = self.__checkEdgeRegion(edge_region, is_vertical, is_dark=False)
            if is_dark_edge or is_bright_edge:
                affected_edges.append(edge_name)
                edge_ratio = dark_ratio if is_dark_edge else bright_ratio
                edge_ratios.append(edge_ratio)
                edge_types.append('dark' if is_dark_edge else 'bright')
                total_penalty = min(
                    total_penalty + self.EDGE_BORDER_PENALTY * (edge_ratio / len(edges)),
                    self.EDGE_BORDER_PENALTY,
                )

        if len(affected_edges) >= self.MIN_EDGES_REQUIRED:
            edges_str = ', '.join(
                f'{e}({r:.2f}/{t})'
                for e, r, t in zip(affected_edges, edge_ratios, edge_types)
            )
            return total_penalty, f'Border effect detected on edges: {edges_str}'
        return 0.0, ''


    def __computeColorBalanceScore(self, img_bgr: NDArray[np.uint8]) -> float:
        height, width = img_bgr.shape[:2]
        scale = min(1.0, math.sqrt(128 * 128 / (height * width)))
        small_img = cv2.resize(img_bgr, None, fx=scale, fy=scale) if scale < 1.0 else img_bgr

        lab_img = cv2.cvtColor(small_img, cv2.COLOR_BGR2Lab)
        pixels = lab_img.reshape(-1, 3).astype(np.float32)

        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
        _, labels, centers = cv2.kmeans(
            pixels, self.COLOR_BALANCE_K, np.array([]),
            criteria, 10, cv2.KMEANS_PP_CENTERS,
        )

        total_pixels = len(labels)
        ratios = np.bincount(labels.flatten()) / total_pixels

        if np.max(ratios) > self.COLOR_BALANCE_MAX_RATIO:
            return 0.2
        significant_colors = np.sum(ratios >= self.COLOR_BALANCE_MIN_RATIO)
        if significant_colors < 2:
            return 0.3

        min_distance = float('inf')
        for i in range(len(centers)):
            for j in range(i + 1, len(centers)):
                if ratios[i] >= self.COLOR_BALANCE_MIN_RATIO and ratios[j] >= self.COLOR_BALANCE_MIN_RATIO:
                    distance = float(np.linalg.norm(centers[i] - centers[j]))
                    min_distance = min(min_distance, distance)

        if min_distance < self.COLOR_BALANCE_MIN_DISTANCE:
            return 0.4

        return float(
            (significant_colors / self.COLOR_BALANCE_K) * 0.4
            + (min(min_distance / 100.0, 1.0)) * 0.3
            + (1.0 - abs(np.std(ratios) - 0.2)) * 0.3
        )


    def __computeImageScore(
        self,
        img_bgr: NDArray[np.uint8],
        face_cascade: cv2.CascadeClassifier | None,
        auxiliary_face_cascade: cv2.CascadeClassifier | None,
        row: int,
        col: int,
    ) -> tuple[float, bool]:
        found_face = False
        face_size_score = 0.0

        letterbox_result = self.__detectLetterbox(img_bgr)
        letterbox_penalty = 0.0
        if letterbox_result is None:
            return (-1000.0, False)
        elif letterbox_result != (slice(0, img_bgr.shape[0]), slice(0, img_bgr.shape[1])):
            logger.debug('Letterbox detected. Penalty applied. (row:%d, col:%d)', row, col)
            letterbox_penalty = self.LETTERBOX_PENALTY
            v_slice, h_slice = letterbox_result
            valid_region = img_bgr[v_slice, h_slice]
        else:
            valid_region = img_bgr

        gray = cv2.cvtColor(valid_region, cv2.COLOR_BGR2GRAY)

        solid_color_penalty = 0.0
        channel_variances = [float(np.var(valid_region[:, :, i])) for i in range(3)]
        is_solid_color = all(var < self.COLOR_VARIANCE_THRESHOLD for var in channel_variances)
        if is_solid_color:
            mean_intensity = float(np.mean(valid_region))
            if mean_intensity < self.BLACK_THRESHOLD:
                logger.debug('Solid black frame detected. (row:%d, col:%d)', row, col)
            elif mean_intensity > self.WHITE_THRESHOLD:
                logger.debug('Solid white frame detected. (row:%d, col:%d)', row, col)
            else:
                logger.debug('Solid color frame detected. (row:%d, col:%d)', row, col)
            solid_color_penalty = self.SOLID_COLOR_PENALTY

        edge_penalty, edge_reason = self.__detectEdgeBorderIssues(valid_region)
        if edge_penalty > 0:
            logger.debug('%s (row:%d, col:%d)', edge_reason, row, col)

        if face_cascade is not None:
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=(self.ANIME_FACE_DETECTION_SCALE_FACTOR
                             if self.face_detection_mode == 'Anime'
                             else self.HUMAN_FACE_DETECTION_SCALE_FACTOR),
                minNeighbors=(self.ANIME_FACE_DETECTION_MIN_NEIGHBORS
                              if self.face_detection_mode == 'Anime'
                              else self.HUMAN_FACE_DETECTION_MIN_NEIGHBORS),
            )
            if len(faces) > 0:
                max_face_area = max(w * h for (_, _, w, h) in faces)
                img_area = valid_region.shape[0] * valid_region.shape[1]
                face_area_ratio = max_face_area / img_area

                if self.face_detection_mode == 'Anime':
                    assert auxiliary_face_cascade is not None
                    human_faces = auxiliary_face_cascade.detectMultiScale(
                        gray,
                        scaleFactor=self.NON_ANIME_FACE_DETECTION_SCALE_FACTOR,
                        minNeighbors=self.NON_ANIME_FACE_DETECTION_MIN_NEIGHBORS,
                    )
                    if len(human_faces) > 0:
                        logger.debug('Human face detected in anime mode. Ignoring. (row:%d, col:%d)', row, col)
                        found_face = False
                        face_size_score = 0.0
                    else:
                        found_face = True
                        if face_area_ratio > self.ANIME_FACE_OPTIMAL_RATIO:
                            excess_ratio = (face_area_ratio - self.ANIME_FACE_OPTIMAL_RATIO) / self.ANIME_FACE_OPTIMAL_RATIO
                            reduction_factor = max(0.5, 1.0 - (excess_ratio * self.ANIME_FACE_RATIO_FALLOFF))
                            face_area_ratio = (self.ANIME_FACE_OPTIMAL_RATIO
                                               + (face_area_ratio - self.ANIME_FACE_OPTIMAL_RATIO) * reduction_factor)
                        face_size_score = self.FACE_SIZE_BASE_SCORE * face_area_ratio * self.ANIME_FACE_SIZE_WEIGHT
                else:
                    found_face = True
                    face_size_score = self.FACE_SIZE_BASE_SCORE * face_area_ratio * self.HUMAN_FACE_SIZE_WEIGHT

        color_balance_score = 0.0
        if self.face_detection_mode == 'Anime':
            color_balance_score = self.__computeColorBalanceScore(valid_region) * self.COLOR_BALANCE_WEIGHT

        img_float = valid_region.astype(np.float32)
        y = 0.2126 * img_float[:, :, 2] + 0.7152 * img_float[:, :, 1] + 0.0722 * img_float[:, :, 0]
        mean_lum = np.mean(y)
        std_lum = np.std(y)

        y_flat = y.flatten()
        p_low = np.percentile(y_flat, self.CONTRAST_PERCENTILE_LOW)
        p_high = np.percentile(y_flat, self.CONTRAST_PERCENTILE_HIGH)
        contrast = p_high - p_low
        distance_ratio = abs(float(mean_lum) - 127.5) / 127.5
        contrast += max(0.0, float(1.0 - distance_ratio)) * float(contrast) * 0.1

        lap = cv2.Laplacian(valid_region, cv2.CV_64F)
        sharpness = float(lap.var()) / 2000.0

        edges = cv2.Canny(gray, 100, 200)
        edge_density = float(np.count_nonzero(edges)) / edges.size
        edge_density_score = max(0.0, 1.0 - abs(edge_density - self.EDGE_DENSITY_TARGET) / self.EDGE_DENSITY_TOLERANCE)
        if edge_density > self.EDGE_DENSITY_TARGET + self.EDGE_DENSITY_TOLERANCE:
            edge_density_score *= 0.7

        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist = hist.flatten() / hist.sum()
        hist = hist[hist > 0]
        entropy = -np.sum(hist * np.log2(hist))
        entropy_score = max(0.0, 1.0 - abs(entropy - self.ENTROPY_TARGET) / self.ENTROPY_TOLERANCE)
        if entropy > self.ENTROPY_TARGET + self.ENTROPY_TOLERANCE:
            entropy_score *= 0.7

        weights = self.ANIME_SCORE_WEIGHTS if self.face_detection_mode == 'Anime' else self.SCORE_WEIGHTS
        std_lum_score = (std_lum / 50.0) * weights['std_lum'] * 100
        contrast_score = (contrast / 200.0) * weights['contrast'] * 100
        sharpness_score = min(sharpness * weights['sharpness'] * 100, 100)
        edge_density_weighted = edge_density_score * weights['edge_density'] * 100
        entropy_weighted = entropy_score * weights['entropy'] * 100

        score = float(
            std_lum_score + contrast_score + sharpness_score
            + edge_density_weighted + entropy_weighted
            + face_size_score + color_balance_score
            - solid_color_penalty - letterbox_penalty - edge_penalty
        )

        logger.debug('Score (row:%d, col:%d): lum=%.2f cont=%.2f sharp=%.2f edge=%.2f '
                     'entropy=%.2f face=%.2f color=%.2f pen=%.2f -> %.2f',
                     row, col, std_lum_score, contrast_score, sharpness_score,
                     edge_density_weighted, entropy_weighted, face_size_score, color_balance_score,
                     solid_color_penalty + letterbox_penalty + edge_penalty, score)

        return (score, found_face)
