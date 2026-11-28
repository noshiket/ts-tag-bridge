# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

from __future__ import annotations

import asyncio
import gc
import logging
import os
import re
import sys
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, ClassVar, Literal, TypedDict, cast

from .psi_archiver import LivePSIDataArchiver
from .quality import LIBRARY_PATH, QUALITY, QUALITY_TYPES
from .pipe_reader import PipeStreamReader
from .tuner import EDCBTuner

if TYPE_CHECKING:
    from .live_stream import LiveStream

logger = logging.getLogger(__name__)


class ChannelInfo(TypedDict):
    display_channel_id: str
    network_id: int
    service_id: int
    transport_stream_id: int
    channel_type: Literal['GR', 'BS', 'CS', 'CATV', 'SKY', 'BS4K']
    service_name: str


TS_PACKET_SIZE = 188


class LiveEncodingTask:

    # H.264 再生時のエンコード後のストリームの GOP 長 (秒)
    GOP_LENGTH_SECONDS_H264: ClassVar[float] = 0.5

    # H.265 再生時のエンコード後のストリームの GOP 長 (秒)
    GOP_LENGTH_SECONDS_H265: ClassVar[float] = float(2)

    # エンコードタスクの最大リトライ回数
    MAX_RETRY_COUNT: ClassVar[int] = 10

    # チューナーから放送波 TS を読み取る際のタイムアウト (秒)
    TUNER_TS_READ_TIMEOUT: ClassVar[int] = 15

    # エンコーダーの出力を読み取る際のタイムアウト (秒)
    ENCODER_TS_READ_TIMEOUT_STANDBY: ClassVar[int] = 20
    ENCODER_TS_READ_TIMEOUT_ONAIR: ClassVar[int] = 5
    ENCODER_TS_READ_TIMEOUT_ONAIR_VCEENCC: ClassVar[int] = 10

    def __init__(self, live_stream: LiveStream, config: dict) -> None:
        self.live_stream = live_stream
        self.config = config
        self._retry_count = 0

    def isFullHDChannel(self, network_id: int, service_id: int) -> bool:
        """
        ネットワーク ID とサービス ID から、そのチャンネルでフル HD 放送が行われているかを返す
        """
        # 地デジでフル HD 放送を行っているチャンネル
        if network_id in [31811, 31940, 32038, 32162, 32311, 32466]:
            return True
        # BS でフル HD 放送を行っているチャンネル
        if network_id == 0x0004 and service_id in [103, 191, 192, 193, 211]:
            return True
        # BS4K・CS4K
        if network_id == 0x000B or network_id == 0x000C:
            return True
        return False

    def buildFFmpegOptions(
        self,
        quality: QUALITY_TYPES,
        channel_type: Literal['GR', 'BS', 'CS', 'CATV', 'SKY', 'BS4K'],
        is_fullhd_channel: bool,
    ) -> list[str]:
        options: list[str] = []

        # 入力ストリームの解析時間
        analyzeduration = round(500000 + (self._retry_count * 200000))
        if channel_type == 'SKY':
            analyzeduration += 200000

        # 入力
        options.append(f'-f mpegts -analyzeduration {analyzeduration} -i pipe:0')

        # ストリームのマッピング
        options.append('-map 0:v:0 -map 0:a:0 -map 0:a:1 -map 0:d? -ignore_unknown')

        # フラグ
        max_interleave_delta = round(500 + (self._retry_count * 100))
        options.append(f'-fflags nobuffer -flags low_delay -max_delay 250000 -max_interleave_delta {max_interleave_delta}K -threads auto')

        # 映像コーデック
        if QUALITY[quality].is_hevc is True:
            options.append('-vcodec libx265')
        else:
            options.append('-vcodec libx264')

        # ビットレートと品質
        options.append(f'-flags +cgop -vb {QUALITY[quality].video_bitrate} -maxrate {QUALITY[quality].video_bitrate_max}')
        options.append('-preset veryfast -aspect 16:9')
        if QUALITY[quality].is_hevc is True:
            options.append('-profile:v main')
        else:
            options.append('-profile:v high')

        # フル HD 対応
        video_width = QUALITY[quality].width
        video_height = QUALITY[quality].height
        if video_width == 1440 and video_height == 1080 and is_fullhd_channel is True:
            video_width = 1920

        # GOP 長
        gop_length_second = self.GOP_LENGTH_SECONDS_H264
        if QUALITY[quality].is_hevc is True:
            gop_length_second = self.GOP_LENGTH_SECONDS_H265

        # インターレース解除
        if channel_type == "BS4K":
            options.append(f'-vf scale={video_width}:{video_height}')
            options.append(f'-r 60000/1001 -g {int(gop_length_second * 60)}')
        else:
            if QUALITY[quality].is_60fps is True:
                options.append(f'-vf yadif=mode=1:parity=-1:deint=1,scale={video_width}:{video_height}')
                options.append(f'-r 60000/1001 -g {int(gop_length_second * 60)}')
            else:
                options.append(f'-vf yadif=mode=0:parity=-1:deint=1,scale={video_width}:{video_height}')
                options.append(f'-r 30000/1001 -g {int(gop_length_second * 30)}')

        # 音声
        options.append(f'-acodec aac -aac_coder twoloop -ac 2 -ab {QUALITY[quality].audio_bitrate} -ar 48000 -af volume=2.0')

        # 出力
        options.append('-y -f mpegts')
        options.append('pipe:1')

        result: list[str] = []
        for option in options:
            result += option.split(' ')
        return result

    def buildHWEncCOptions(
        self,
        quality: QUALITY_TYPES,
        encoder_type: Literal['QSVEncC', 'NVEncC', 'VCEEncC', 'rkmppenc'],
        channel_type: Literal['GR', 'BS', 'CS', 'CATV', 'SKY', 'BS4K'],
        is_fullhd_channel: bool,
    ) -> list[str]:
        options: list[str] = []

        # 入力ストリームの解析時間
        input_probesize = round(1000 + (self._retry_count * 500))
        input_analyze = round(0.7 + (self._retry_count * 0.2), 1)
        if channel_type == 'SKY':
            input_probesize += 500
            input_analyze += 0.2

        # 入力
        options.append(f'--input-format mpegts --input-probesize {input_probesize}K --input-analyze {input_analyze}')
        if channel_type != 'BS4K':
            options.append('--fps 30000/1001')
        options.append('--input -')
        if encoder_type == 'VCEEncC':
            options.append('--avsw')
        else:
            options.append('--avhw')

        # ストリームのマッピング
        options.append('--audio-stream 1?:stereo --audio-stream 2?:stereo --data-copy timed_id3')

        # フラグ
        max_interleave_delta = round(500 + (self._retry_count * 100))
        options.append('-m avioflags:direct -m fflags:nobuffer+flush_packets -m flush_packets:1 -m max_delay:250000')
        options.append(f'-m max_interleave_delta:{max_interleave_delta}K --output-thread 0 --lowlatency')
        if encoder_type == 'QSVEncC' or encoder_type == 'rkmppenc':
            options.append('--disable-opencl')
        if encoder_type == 'NVEncC':
            options.append('--disable-nvml 1 --disable-dx11 --disable-vulkan')
        options.append('--log-level debug')

        # 映像コーデック
        if QUALITY[quality].is_hevc is True:
            options.append('--codec hevc')
        else:
            options.append('--codec h264')

        # ビットレート
        if QUALITY[quality].is_hevc is True and encoder_type == 'QSVEncC':
            options.append(f'--qvbr {QUALITY[quality].video_bitrate} --fallback-rc')
        else:
            options.append(f'--vbr {QUALITY[quality].video_bitrate}')
        options.append(f'--max-bitrate {QUALITY[quality].video_bitrate_max}')

        # H.265/HEVC の高圧縮化調整
        if QUALITY[quality].is_hevc is True:
            if encoder_type == 'QSVEncC':
                options.append('--qvbr-quality 20 --extbrc --mbbrc --scenario-info game_streaming --tune perceptual')
                options.append('--i-adapt --b-adapt --b-pyramid --weightp --weightb --adapt-ref --adapt-ltr --adapt-cqm')
            elif encoder_type == 'NVEncC':
                options.append('--qp-min 23:26:30 --lookahead 16 --multipass 2pass-full --bref-mode middle --aq --aq-temporal')

        # ヘッダ情報制御
        if encoder_type != 'VCEEncC':
            options.append('--repeat-headers')

        # 品質
        if encoder_type == 'QSVEncC':
            options.append('--quality balanced')
        elif encoder_type == 'NVEncC':
            options.append('--preset default')
        elif encoder_type == 'VCEEncC':
            options.append('--preset balanced')
        elif encoder_type == 'rkmppenc':
            options.append('--preset best')
        if QUALITY[quality].is_hevc is True:
            options.append('--profile main')
        else:
            options.append('--profile high')
        options.append('--dar 16:9')

        # バンディング軽減
        if encoder_type == 'NVEncC':
            options.append('--vpp-deband')

        # GOP 長
        gop_length_second = self.GOP_LENGTH_SECONDS_H264
        if QUALITY[quality].is_hevc is True:
            gop_length_second = self.GOP_LENGTH_SECONDS_H265

        # インターレース解除
        if channel_type == "BS4K":
            options.append(f'--avsync vfr --gop-len {int(gop_length_second * 60)}')
        else:
            options.append('--interlace tff')
            if QUALITY[quality].is_60fps is True:
                if encoder_type == 'QSVEncC':
                    options.append('--vpp-deinterlace bob')
                elif encoder_type == 'NVEncC' or encoder_type == 'VCEEncC':
                    options.append('--vpp-yadif mode=bob')
                elif encoder_type == 'rkmppenc':
                    options.append('--vpp-deinterlace bob_i5')
                options.append(f'--avsync vfr --gop-len {int(gop_length_second * 60)}')
            else:
                if encoder_type == 'QSVEncC':
                    options.append('--vpp-deinterlace normal')
                elif encoder_type == 'NVEncC' or encoder_type == 'VCEEncC':
                    options.append('--vpp-afs preset=default')
                elif encoder_type == 'rkmppenc':
                    options.append('--vpp-deinterlace normal_i5')
                options.append(f'--avsync vfr --gop-len {int(gop_length_second * 30)}')

        # フル HD 対応
        video_width = QUALITY[quality].width
        video_height = QUALITY[quality].height
        if video_width == 1440 and video_height == 1080 and is_fullhd_channel is True:
            video_width = 1920
        options.append(f'--output-res {video_width}x{video_height}')

        # 音声
        options.append(f'--audio-codec aac:aac_coder=twoloop --audio-bitrate {QUALITY[quality].audio_bitrate}')
        options.append('--audio-samplerate 48000 --audio-filter volume=2.0 --audio-ignore-decode-error 30')

        # 出力
        options.append('--output-format mpegts')
        options.append('--output -')

        result: list[str] = []
        for option in options:
            result += option.split(' ')
        return result

    async def run(self) -> None:
        """エンコードタスクを実行する"""

        ENCODER_TYPE = self.config.get('encoder', 'FFmpeg')
        debug_ts_path: str | None = self.config.get('debug_ts_path')

        # まだ Standby になっていなければ設定
        if not (self.live_stream.getStatus().status == 'Standby'
                and self.live_stream.getStatus().detail == 'エンコードタスクを起動しています…'):
            self.live_stream.setStatus('Standby', 'エンコードタスクを起動しています…')

        # チャンネル情報を取得
        channel_info: ChannelInfo | None = self.live_stream.channel_info
        if channel_info is None:
            self.live_stream.setStatus('Offline', 'チャンネル情報が見つかりません。')
            self.live_stream.disconnectAll()
            return

        service_id = channel_info['service_id']
        network_id = channel_info['network_id']
        transport_stream_id = channel_info['transport_stream_id']
        channel_type = channel_info['channel_type']

        logger.info(f'[Live: {self.live_stream.live_stream_id}] Channel: {channel_info["service_name"]} '
                     f'(NID:{network_id} SID:{service_id} TSID:{transport_stream_id})')

        # PSI/SI データアーカイバーを初期化
        self.live_stream.psi_data_archiver = LivePSIDataArchiver(service_id)

        # ***** tsreadex プロセスの作成と実行 *****

        tsreadex_options = [
            '-x', '18/38/39',
            '-n', f'{service_id}' if debug_ts_path is None else '-1',
            '-a', '13',
            '-b', '5',
            '-c', '5',
            '-u', '1',
            '-d', '13' if ENCODER_TYPE != 'FFmpeg' and sys.platform == 'linux' else '9',
        ]

        if debug_ts_path is None:
            tsreadex_options.append('-')
        else:
            tsreadex_options += ['-l', '2350', debug_ts_path]

        tsreadex_read_pipe, tsreadex_write_pipe = os.pipe()

        tsreadex = await asyncio.subprocess.create_subprocess_exec(
            *[LIBRARY_PATH['tsreadex'], *tsreadex_options],
            stdin=asyncio.subprocess.PIPE,
            stdout=tsreadex_write_pipe,
            stderr=asyncio.subprocess.DEVNULL,
        )
        os.close(tsreadex_write_pipe)

        # ***** エンコーダープロセスの作成と実行 *****

        is_fullhd_channel = self.isFullHDChannel(network_id, service_id)

        if ENCODER_TYPE == 'FFmpeg':
            encoder_options = self.buildFFmpegOptions(self.live_stream.quality, channel_type, is_fullhd_channel)
            logger.info(f'[Live: {self.live_stream.live_stream_id}] FFmpeg Commands:\nffmpeg {" ".join(encoder_options)}')
            encoder = await asyncio.subprocess.create_subprocess_exec(
                *[LIBRARY_PATH['FFmpeg'], *encoder_options],
                stdin=tsreadex_read_pipe,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            encoder_options = self.buildHWEncCOptions(self.live_stream.quality, ENCODER_TYPE, channel_type, is_fullhd_channel)
            logger.info(f'[Live: {self.live_stream.live_stream_id}] {ENCODER_TYPE} Commands:\n{ENCODER_TYPE} {" ".join(encoder_options)}')
            encoder = await asyncio.subprocess.create_subprocess_exec(
                *[LIBRARY_PATH[ENCODER_TYPE], *encoder_options],
                stdin=tsreadex_read_pipe,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        os.close(tsreadex_read_pipe)

        # ***** チューナーの起動と接続 *****

        is_running: bool = True
        stream_reader: asyncio.StreamReader | PipeStreamReader | None = None
        background_tasks: set[asyncio.Task[None]] = set()

        try:
            # チューナーインスタンスを取得する
            if self.live_stream.tuner is None:
                self.live_stream.tuner = EDCBTuner.getOrCreate(self.live_stream.live_stream_id)

            # チューナーを起動する
            logger.debug(f'[Live: {self.live_stream.live_stream_id}] EDCB NetworkTV ID: {self.live_stream.tuner.getEDCBNetworkTVID()}')
            self.live_stream.setStatus('Standby', 'チューナーを起動しています…')
            is_tuner_opened = await self.live_stream.tuner.setChannel(
                network_id,
                service_id,
                transport_stream_id,
                self.live_stream.live_stream_id,
            )

            if is_tuner_opened is False:
                self.live_stream.setStatus('Offline', 'チューナーの起動に失敗しました。空きチューナーが不足していると考えられます。(E-02E)')
                await self.live_stream.tuner.close(self.live_stream.live_stream_id)
                self.live_stream.disconnectAll()
                if self.live_stream.psi_data_archiver is not None:
                    self.live_stream.psi_data_archiver.destroy()
                    self.live_stream.psi_data_archiver = None
                try:
                    tsreadex.kill()
                    encoder.kill()
                except Exception:
                    pass
                return

            # チューナーをロックする
            self.live_stream.tuner.lock(self.live_stream.live_stream_id)

            # チューナーに接続する
            self.live_stream.setStatus('Standby', 'チューナーに接続しています…')
            reader = await self.live_stream.tuner.connect(self.live_stream.live_stream_id)

            if reader is None:
                self.live_stream.setStatus('Offline', 'チューナーへの接続に失敗しました。チューナー側に何らかの問題があるかもしれません。(E-03E)')
                await self.live_stream.tuner.close(self.live_stream.live_stream_id)
                self.live_stream.disconnectAll()
                if self.live_stream.psi_data_archiver is not None:
                    self.live_stream.psi_data_archiver.destroy()
                    self.live_stream.psi_data_archiver = None
                try:
                    tsreadex.kill()
                    encoder.kill()
                except Exception:
                    pass
                return

            stream_reader = reader

            # ***** チューナーからの出力の読み込み → tsreadex・エンコーダーへの書き込み *****

            tuner_ts_read_at: float = time.monotonic()
            tuner_ts_read_at_lock = asyncio.Lock()

            async def Reader() -> None:
                nonlocal tuner_ts_read_at

                async def GetIterator(
                    sr: asyncio.StreamReader | PipeStreamReader,
                    chunk_size: int = TS_PACKET_SIZE * 256,
                ) -> AsyncIterator[bytes]:
                    while True:
                        try:
                            yield await sr.readexactly(chunk_size)
                        except asyncio.IncompleteReadError as ex:
                            if ex.partial:
                                yield ex.partial
                            break

                assert stream_reader is not None
                stream_iterator = GetIterator(stream_reader)

                try:
                    async for chunk in stream_iterator:
                        async with tuner_ts_read_at_lock:
                            tuner_ts_read_at = time.monotonic()

                        if cast(asyncio.StreamWriter, tsreadex.stdin).is_closing():
                            break

                        try:
                            cast(asyncio.StreamWriter, tsreadex.stdin).write(chunk)
                            await cast(asyncio.StreamWriter, tsreadex.stdin).drain()

                            if self.live_stream.psi_data_archiver is not None:
                                background_tasks.add(asyncio.create_task(
                                    self.live_stream.psi_data_archiver.pushTSPacketData(chunk)))
                        except Exception:
                            break

                        if is_running is False or tsreadex.returncode is not None or encoder.returncode is not None:
                            break
                except OSError:
                    pass

                try:
                    cast(asyncio.StreamWriter, tsreadex.stdin).close()
                except OSError:
                    pass

                await asyncio.sleep(0.1)

                if self.live_stream.tuner is not None:
                    await self.live_stream.tuner.disconnect(self.live_stream.live_stream_id)

            background_tasks.add(asyncio.create_task(Reader()))

            # ***** tsreadex・エンコーダーからの出力の読み込み → ライブストリームへの書き込み *****

            chunk_buffer: bytearray = bytearray()
            chunk_written_at: float = 0
            writer_lock = asyncio.Lock()

            async def Writer() -> None:
                nonlocal chunk_buffer, chunk_written_at

                READ_SIZE = TS_PACKET_SIZE * 256  # 48128 bytes — Reader と同じチャンクサイズ

                while True:
                    try:
                        chunk = await cast(asyncio.StreamReader, encoder.stdout).read(READ_SIZE)
                        if not chunk:
                            break
                        async with writer_lock:
                            chunk_buffer += chunk
                            if len(chunk_buffer) >= 65536:
                                await self.live_stream.writeStreamData(bytes(chunk_buffer))
                                chunk_buffer = bytearray()
                                chunk_written_at = time.monotonic()
                    except (asyncio.IncompleteReadError, OSError):
                        break
                    if is_running is False or tsreadex.returncode is not None or encoder.returncode is not None:
                        break

            async def SubWriter() -> None:
                nonlocal chunk_buffer, chunk_written_at

                while True:
                    await asyncio.sleep(0.025)
                    async with writer_lock:
                        if (time.monotonic() - chunk_written_at) > 0.025 and (len(chunk_buffer) > 0):
                            await self.live_stream.writeStreamData(bytes(chunk_buffer))
                            chunk_buffer = bytearray()
                            chunk_written_at = time.monotonic()
                    if is_running is False or tsreadex.returncode is not None or encoder.returncode is not None:
                        break

            background_tasks.add(asyncio.create_task(Writer()))
            background_tasks.add(asyncio.create_task(SubWriter()))

            # ***** エンコーダーの状態監視 *****

            lines: list[str] = []

            async def EncoderObServer() -> None:
                nonlocal lines

                while True:
                    buffer = bytearray()
                    while True:
                        byte = await cast(asyncio.StreamReader, encoder.stderr).read(1)
                        buffer += byte
                        if byte == b'\r' or byte == b'\n':
                            break
                        if byte == b'':
                            break

                    if len(buffer) == 0:
                        break

                    try:
                        line = buffer.decode('utf-8').strip()
                    except UnicodeDecodeError:
                        continue

                    # HWEncC のログからゴミを除去
                    match1 = re.fullmatch(r'^.*?([1-9][0-9]+ frames: [0-9\.]+ fps, [0-9]+ kb/s, GPU [0-9]+%, VE [0-9]+%, VD [0-9]+%)$', line)
                    match2 = re.fullmatch(r'^.*?([1-9][0-9]+ frames: [0-9\.]+ fps, [0-9]+ kb/s, GPU [0-9]+%, VD [0-9]+%)$', line)
                    match3 = re.fullmatch(r'^.*?([1-9][0-9]+ frames: [0-9\.]+ fps, [0-9]+ kb/s)$', line)
                    if match1 is not None:
                        line = match1.groups()[0]
                    elif match2 is not None:
                        line = match2.groups()[0]
                    elif match3 is not None:
                        line = match3.groups()[0]

                    # 山ほど出力されるメッセージと空行をログから除外
                    if (('removing 2 bytes from input bitstream not read by decoder.' not in line) and
                        ('Delay between the' not in line) and
                        ('[h264_metadata' not in line) and
                        ('[hevc_metadata' not in line) and
                        ('packet in the muxing queue' not in line) and ('ing output' not in line) and
                        ('ng output' != line) and ('g output' != line) and (' output' != line) and ('output' != line) and
                        ('utput' != line) and ('tput' != line) and ('put' != line) and ('ut' != line) and ('t' != line) and
                        ('' != line)):

                        lines.append(line)

                        if 'Stream #0:' in line:
                            logger.debug(f'[Live: {self.live_stream.live_stream_id}] [{ENCODER_TYPE}] {line}')

                    # ステータス更新
                    live_stream_status = self.live_stream.getStatus()
                    if live_stream_status.status == 'Standby':
                        if ENCODER_TYPE == 'FFmpeg':
                            if 'arib parser was created' in line or 'Invalid frame dimensions 0x0.' in line:
                                self.live_stream.setStatus('Standby', 'エンコードを開始しています…')
                            elif 'frame=    1 fps=0.0 q=0.0' in line or 'size=       0kB time=00:00' in line:
                                self.live_stream.setStatus('Standby', 'バッファリングしています…')
                            elif 'frame=' in line or 'bitrate=' in line:
                                self.live_stream.setStatus('ONAir', 'ライブストリームは ONAir です。')
                                if self._retry_count > 0:
                                    self._retry_count = 0
                        else:
                            if 'opened file "pipe:0"' in line:
                                self.live_stream.setStatus('Standby', 'エンコードを開始しています…')
                            elif 'starting output thread...' in line or 'Encode Thread:' in line:
                                self.live_stream.setStatus('Standby', 'バッファリングしています…')
                            elif ' frames: ' in line:
                                self.live_stream.setStatus('ONAir', 'ライブストリームは ONAir です。')
                                if self._retry_count > 0:
                                    self._retry_count = 0

                    # エラー検出
                    if ENCODER_TYPE == 'FFmpeg':
                        if 'Stream map \'0:v:0\' matches no streams.' in line:
                            self.live_stream.setStatus('Offline', 'チューナーからの放送波の受信に失敗したため、エンコードを開始できません。(E-04F)')
                        elif 'Conversion failed!' in line:
                            result = self.live_stream.setStatus('Restart', 'エンコード中に予期しないエラーが発生しました。エンコードタスクを再起動しています… (ER-01F)')
                            if result is True:
                                for log in lines[-51:-1]:
                                    logger.warning(log)
                    else:
                        if 'error finding stream information.' in line:
                            self.live_stream.setStatus('Offline', 'チューナーからの放送波の受信に失敗したため、エンコードを開始できません。(E-05H)')
                        elif ENCODER_TYPE == 'NVEncC' and 'due to the NVIDIA\'s driver limitation.' in line:
                            self.live_stream.setStatus('Offline', 'NVENC のエンコードセッションが不足しているため、エンコードを開始できません。(E-06HN)')
                        elif ENCODER_TYPE == 'QSVEncC' and ('unable to decode by qsv.' in line or 'No device found for QSV encoding!' in line):
                            self.live_stream.setStatus('Offline', 'お使いの PC 環境は QSVEncC エンコーダーに対応していません。(E-07HQ)')
                        elif ENCODER_TYPE == 'QSVEncC' and 'iHD_drv_video.so init failed' in line:
                            self.live_stream.setStatus('Offline', 'お使いの PC 環境は Linux 版 QSVEncC エンコーダーに対応していません。(E-08HQ)')
                        elif ENCODER_TYPE == 'NVEncC' and 'CUDA not available.' in line:
                            self.live_stream.setStatus('Offline', 'お使いの PC 環境は NVEncC エンコーダーに対応していません。(E-09HN)')
                        elif ENCODER_TYPE == 'VCEEncC' and \
                            ('Failed to initalize VCE factory:' in line or 'Assertion failed:Init() failed to vkCreateInstance' in line):
                            self.live_stream.setStatus('Offline', 'お使いの PC 環境は VCEEncC エンコーダーに対応していません。(E-10HV)')
                        elif 'Consider increasing the value for the --input-analyze and/or --input-probesize!' in line:
                            self.live_stream.setStatus('Restart', '入力ストリームの解析に失敗しました。エンコードタスクを再起動しています… (ER-02H)')
                        elif 'finished with error!' in line:
                            await asyncio.sleep(0.5)
                            result = self.live_stream.setStatus('Restart', 'エンコード中に予期しないエラーが発生しました。エンコードタスクを再起動しています… (ER-03H)')
                            if result is True:
                                for log in lines[-151:-1]:
                                    logger.warning(log)

                    if is_running is False or tsreadex.returncode is not None or encoder.returncode is not None:
                        break

            background_tasks.add(asyncio.create_task(EncoderObServer()))

            # ***** エンコードタスク全体の制御 *****

            async def Controller() -> None:
                nonlocal lines

                while True:
                    live_stream_status = self.live_stream.getStatus()

                    # 現在 ONAir でかつクライアント数が 0 なら Idling に移行
                    if live_stream_status.status == 'ONAir' and live_stream_status.client_count == 0:
                        self.live_stream.setStatus('Idling', 'ライブストリームは Idling です。')

                    # Idling で max_alive_time 秒以上経過したら Offline に移行
                    max_alive_time = self.config.get('max_alive_time', 10)
                    if ((live_stream_status.status == 'Idling') and
                        (time.time() - live_stream_status.updated_at > max_alive_time)):
                        self.live_stream.setStatus('Offline', 'ライブストリームは Offline です。')

                    # チューナーからの放送波読み取りタイムアウト
                    async with tuner_ts_read_at_lock:
                        if (time.monotonic() - tuner_ts_read_at) > self.TUNER_TS_READ_TIMEOUT:
                            self.live_stream.setStatus('Offline', 'チューナーからの放送波の受信がタイムアウトしました。(E-11)')

                    # エンコーダーの出力タイムアウト
                    encoder_ts_read_timeout_onair = \
                        self.ENCODER_TS_READ_TIMEOUT_ONAIR_VCEENCC if ENCODER_TYPE == 'VCEEncC' else self.ENCODER_TS_READ_TIMEOUT_ONAIR
                    stream_data_last_write_time = time.time() - self.live_stream.getStreamDataWrittenAt()
                    if ((live_stream_status.status == 'Standby' and stream_data_last_write_time > self.ENCODER_TS_READ_TIMEOUT_STANDBY) or
                        (live_stream_status.status == 'ONAir' and stream_data_last_write_time > encoder_ts_read_timeout_onair)):
                        await asyncio.sleep(1)
                        result = self.live_stream.setStatus('Restart', 'エンコードが途中で停止しました。エンコードタスクを再起動しています… (ER-04)')
                        if result is True:
                            log_count = 51 if ENCODER_TYPE == 'FFmpeg' else 151
                            for log in lines[-log_count:-1]:
                                logger.warning(log)

                    # チューナーとの接続が切断された場合
                    if self.live_stream.tuner is not None and self.live_stream.tuner.isDisconnected() is True:
                        self.live_stream.setStatus('Restart', 'チューナーとの接続が切断されました。エンコードタスクを再起動しています… (ER-05)')

                    # エンコーダーが意図せず終了した場合
                    if encoder.returncode is not None:
                        # H.265/HEVC 非対応チェック（初回のみ）
                        if self._retry_count == 0:
                            for line in lines:
                                if ENCODER_TYPE == 'QSVEncC' and 'HEVC encoding is not supported on current platform.' in line:
                                    self.live_stream.setStatus('Offline', 'お使いの Intel GPU は H.265/HEVC でのエンコードに対応していません。(E-14HQ)')
                                    break
                                elif ENCODER_TYPE == 'NVEncC' and 'does not support H.265/HEVC encoding.' in line:
                                    available_for_encode = any('available for encode.' in l for l in lines)
                                    if not available_for_encode:
                                        self.live_stream.setStatus('Offline', 'お使いの NVIDIA GPU は H.265/HEVC でのエンコードに対応していません。(E-15HN)')
                                        break
                                elif ENCODER_TYPE == 'VCEEncC' and 'HW Acceleration of H.265/HEVC is not supported on this platform.' in line:
                                    self.live_stream.setStatus('Offline', 'お使いの AMD GPU は H.265/HEVC でのエンコードに対応していません。(E-16HV)')
                                    break

                        if self.live_stream.getStatus().status != 'Offline':
                            result = self.live_stream.setStatus('Restart', 'エンコーダーが強制終了されました。エンコードタスクを再起動しています… (ER-06)')
                            if result is True:
                                log_count = 51 if ENCODER_TYPE == 'FFmpeg' else 151
                                for log in lines[-log_count:-1]:
                                    logger.warning(log)
                        break

                    # Offline か Restart ならループ終了
                    live_stream_status = self.live_stream.getStatus()
                    if live_stream_status.status == 'Offline' or live_stream_status.status == 'Restart':
                        break

                    await asyncio.sleep(0.1)

            await Controller()

        except asyncio.CancelledError:
            logger.debug(f'[Live: {self.live_stream.live_stream_id}] Encoding task was cancelled by channel switch.')

        # ***** エンコードタスクの終了処理 *****

        is_running = False

        try:
            tsreadex.kill()
            encoder.kill()
        except Exception:
            pass

        # すべての視聴中クライアントのライブストリームへの接続を切断する
        self.live_stream.disconnectAll()

        if self.live_stream.psi_data_archiver is not None:
            self.live_stream.psi_data_archiver.destroy()
            self.live_stream.psi_data_archiver = None

        # エンコードタスクを再起動する
        if self.live_stream.getStatus().status == 'Restart':
            if self.live_stream.tuner is not None:
                self.live_stream.tuner.unlock(self.live_stream.live_stream_id)

            if self._retry_count < self.MAX_RETRY_COUNT:
                self._retry_count += 1
                await asyncio.sleep(0.1)
                background_tasks.add(asyncio.create_task(self.run()))
            else:
                self.live_stream.setStatus('Offline', 'ライブストリームの再起動に失敗しました。(E-17)')
                if self.live_stream.tuner is not None:
                    if await self.live_stream.tuner.close(self.live_stream.live_stream_id) is True:
                        self.live_stream.tuner = None

        # 通常終了
        else:
            if self.live_stream.tuner is not None:
                if self.live_stream.tuner.getState() == 'Cancelling':
                    gc.collect()
                    return
                if await self.live_stream.tuner.close(self.live_stream.live_stream_id) is True:
                    self.live_stream.tuner = None

        gc.collect()
