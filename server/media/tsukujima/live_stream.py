# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Callable, ClassVar, Literal, Optional

from .encoding_task import LiveEncodingTask, ChannelInfo
from .psi_archiver import LivePSIDataArchiver
from .quality import QUALITY_TYPES
from .tuner import EDCBTuner

logger = logging.getLogger(__name__)


@dataclass
class LiveStreamStatus:
    status: str
    detail: str
    started_at: float
    updated_at: float
    client_count: int


class LiveStreamClient:
    """ ライブストリームのクライアントを表すクラス """

    def __init__(self, live_stream: LiveStream, client_type: Literal['mpegts']) -> None:
        self._live_stream: LiveStream = live_stream
        self.client_id: str = f'MPEGTS-{uuid.uuid4().hex[:10]}'
        self.client_type: Literal['mpegts'] = client_type
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._stream_data_read_at: float = time.time()

    @property
    def stream_data_read_at(self) -> float:
        return self._stream_data_read_at

    async def readStreamData(self) -> bytes | None:
        if self.client_type != 'mpegts':
            return None
        self._stream_data_read_at = time.time()
        try:
            return await self._queue.get()
        except TypeError:
            return None

    def writeStreamData(self, stream_data: bytes | None) -> None:
        if self.client_type != 'mpegts':
            return None
        self._queue.put_nowait(stream_data)


class LiveStream:
    """ ライブストリームを管理するクラス """

    # ライブストリームのインスタンスが入る辞書
    __instances: ClassVar[dict[str, LiveStream]] = {}

    # クラスレベル設定 (configure() で設定)
    _tcp_url: ClassVar[str] = ''
    _streaming_config: ClassVar[dict] = {}
    _channel_map: ClassVar[dict[str, ChannelInfo]] = {}
    # チャンネルマップが空のとき再構築するための EDCB サービス取得関数 (enum_service)
    _service_fetcher: ClassVar[Optional[Callable[[], list[dict]]]] = None
    _last_channel_build: ClassVar[float] = 0.0

    @classmethod
    def configure(cls, tcp_url: str, services: list[dict], streaming_config: dict,
                  service_fetcher: Optional[Callable[[], list[dict]]] = None) -> None:
        """
        クラスレベルの設定を行う。アプリケーション起動時に一度だけ呼び出すこと。

        Args:
            tcp_url: EDCB CtrlCmd 接続先 URL (例: 'tcp://n100dcitx:4510')
            services: edcb_api.enum_service() の戻り値
            streaming_config: config.yml の streaming セクション
            service_fetcher: チャンネルマップが空のとき再取得するための enum_service 関数
        """
        cls._tcp_url = tcp_url
        cls._streaming_config = streaming_config
        cls._service_fetcher = service_fetcher
        cls._channel_map = cls._build_channel_map(services or [])
        cls._last_channel_build = time.time()
        EDCBTuner.configure(tcp_url)
        logger.info(f'LiveStream configured: {len(cls._channel_map)} channels available')

    @classmethod
    def ensure_channels(cls) -> None:
        """チャンネルマップが空なら EDCB から再取得して再構築する (self-healing)。
        起動時に EDCB が不通でチャンネル0件のまま固まるのを防ぐ。
        ※ enum_service は同期(blocking)のため、同期ルート(getChannelList)からのみ呼ぶこと。
        """
        if cls._channel_map or cls._service_fetcher is None:
            return
        # EDCB が落ち続けている場合に毎回叩かないよう 10 秒スロットル
        if time.time() - cls._last_channel_build < 10:
            return
        cls._last_channel_build = time.time()
        try:
            services = cls._service_fetcher()
            if services:
                cls._channel_map = cls._build_channel_map(services)
                logger.info(f'LiveStream channel map rebuilt: {len(cls._channel_map)} channels')
        except Exception as e:
            logger.warning(f'LiveStream channel rebuild failed: {e}')

    @classmethod
    def _build_channel_map(cls, services: list[dict]) -> dict[str, ChannelInfo]:
        """EDCB サービス一覧から display_channel_id → ChannelInfo のマッピングを構築する"""
        channel_map: dict[str, ChannelInfo] = {}
        seen_gr_onid: set[int] = set()

        # TV サービス (service_type == 1) のみ対象
        tv_services = [s for s in services if s.get('service_type') == 1]

        for s in sorted(tv_services, key=lambda x: x.get('sid', 0)):
            onid = s.get('onid', 0)
            sid = s.get('sid', 0)
            tsid = s.get('tsid', 0)
            service_name = s.get('service_name', '')
            remocon = s.get('remote_control_key_id', 0)

            # チャンネルタイプを判定
            channel_type: Literal['GR', 'BS', 'CS', 'CATV', 'SKY', 'BS4K']
            if onid >= 0x7880:
                channel_type = 'GR'
            elif onid == 0x0004:
                channel_type = 'BS'
            elif onid in (0x0006, 0x0007):
                channel_type = 'CS'
            elif onid == 0x000A:
                channel_type = 'SKY'
            elif onid == 0x000B:
                channel_type = 'BS4K'
            else:
                continue

            # display_channel_id を構築
            if channel_type == 'GR':
                # 同一局(onid)はSID昇順の先頭(主サービス)のみ登録する。
                # ※以前はリモコンキー単位でdedupしていたため、キーが重複する別局
                #   (地方局どうし等)が丸ごと登録されず視聴不能になっていた。
                if onid in seen_gr_onid:
                    continue
                seen_gr_onid.add(onid)
                # リモコンキー重複・不明(<=0)の局は+13ずつずらした空き番号へ登録する
                # (display_channel_idは内部識別子で、一意でありさえすればよい)
                n = remocon if remocon > 0 else 13
                while f'gr{n:03d}' in channel_map:
                    n += 13
                display_channel_id = f'gr{n:03d}'
            elif channel_type == 'BS' or channel_type == 'BS4K':
                display_channel_id = f'bs{sid:03d}'
            elif channel_type == 'CS':
                display_channel_id = f'cs{sid:03d}'
            elif channel_type == 'SKY':
                display_channel_id = f'sky{sid:03d}'
            else:
                continue

            channel_map[display_channel_id] = ChannelInfo(
                display_channel_id=display_channel_id,
                network_id=onid,
                service_id=sid,
                transport_stream_id=tsid,
                channel_type=channel_type,
                service_name=service_name,
            )

        return channel_map

    @classmethod
    def resolve_channel(cls, display_channel_id: str) -> ChannelInfo | None:
        """display_channel_id からチャンネル情報を解決する"""
        return cls._channel_map.get(display_channel_id)

    @classmethod
    def getChannelList(cls) -> list[ChannelInfo]:
        """利用可能なチャンネル一覧を返す"""
        cls.ensure_channels()   # 空なら EDCB から再構築 (同期ルート経由なのでブロッキング可)
        return list(cls._channel_map.values())

    # Singleton: チャンネル ID と品質の組ごとに1つのインスタンス
    def __new__(cls, display_channel_id: str, quality: QUALITY_TYPES) -> LiveStream:
        live_stream_id = f'{display_channel_id}-{quality}'
        if live_stream_id not in cls.__instances:
            instance = super().__new__(cls)
            instance.live_stream_id = live_stream_id
            instance.display_channel_id = display_channel_id
            instance.quality = quality
            instance.channel_info = cls._channel_map.get(display_channel_id)
            instance._clients = []
            instance._status = 'Offline'
            instance._detail = 'ライブストリームは Offline です。'
            instance._started_at = 0
            instance._updated_at = 0
            instance._stream_data_written_at = 0
            instance._live_encoding_task_ref = None
            instance.psi_data_archiver = None
            instance.tuner = None
            instance._tuner_lock = asyncio.Lock()
            cls.__instances[live_stream_id] = instance
        return cls.__instances[live_stream_id]

    def __init__(self, display_channel_id: str, quality: QUALITY_TYPES) -> None:
        # 型ヒントのみ (Singleton のためインスタンスの生成は __new__() で行う)
        self.live_stream_id: str
        self.display_channel_id: str
        self.quality: QUALITY_TYPES
        self.channel_info: ChannelInfo | None
        self._clients: list[LiveStreamClient]
        self._status: Literal['Offline', 'Standby', 'ONAir', 'Idling', 'Restart']
        self._detail: str
        self._started_at: float
        self._updated_at: float
        self._stream_data_written_at: float
        self._live_encoding_task_ref: asyncio.Task[None] | None
        self.psi_data_archiver: LivePSIDataArchiver | None
        self.tuner: EDCBTuner | None
        self._tuner_lock: asyncio.Lock

    @classmethod
    def getAllLiveStreams(cls) -> list[LiveStream]:
        return list(cls.__instances.values())

    @classmethod
    def getONAirLiveStreams(cls) -> list[LiveStream]:
        return [ls for ls in cls.getAllLiveStreams() if ls.getStatus().status == 'ONAir']

    @classmethod
    def getIdlingLiveStreams(cls) -> list[LiveStream]:
        return [ls for ls in cls.getAllLiveStreams() if ls.getStatus().status == 'Idling']

    @classmethod
    def getViewerCount(cls, display_channel_id: str) -> int:
        count = 0
        for ls in cls.getAllLiveStreams():
            if ls.display_channel_id == display_channel_id:
                count += ls.getStatus().client_count
        return count

    async def connect(self, client_type: Literal['mpegts']) -> LiveStreamClient:
        """ライブストリームに接続して新しいクライアントを返す"""

        current_status = self._status
        should_start_task: bool = False

        if current_status == 'Offline':
            async with self._tuner_lock:
                if self._status == 'Offline':
                    self.setStatus('Standby', 'エンコードタスクを起動しています…')
                    should_start_task = True

            # チューナー再利用: Idling/ONAir (client_count == 0) のストリームからチューナーを移譲
            if should_start_task is True:
                for _ in range(15):
                    found_reusable_tuner = False
                    should_wait_next_retry = False

                    for live_stream in LiveStream.getAllLiveStreams():
                        if live_stream is self:
                            continue

                        async with live_stream._tuner_lock:
                            live_stream_status = live_stream.getStatus()

                        if live_stream_status.client_count != 0 and live_stream_status.status != 'Standby':
                            if live_stream_status.status in ('ONAir', 'Idling'):
                                should_wait_next_retry = True
                            continue

                        if live_stream_status.status not in ('Standby', 'ONAir', 'Idling'):
                            continue

                        if live_stream.tuner is None:
                            continue

                        if live_stream.tuner.getState() == 'Cancelling':
                            continue

                        # チューナー再利用のため、状態をキャンセル中に切り替え
                        live_stream.tuner.setState('Cancelling')
                        live_stream.setStatus('Offline', '新しいライブストリームが開始されたため、チューナーリソースを再利用します。')
                        live_stream.disconnectAll()

                        if live_stream.psi_data_archiver is not None:
                            live_stream.psi_data_archiver.destroy()
                            live_stream.psi_data_archiver = None

                        await live_stream.tuner.disconnect(live_stream.live_stream_id)

                        if live_stream.tuner.handoff(live_stream.live_stream_id, self.live_stream_id) is False:
                            continue

                        if live_stream._live_encoding_task_ref is not None:
                            live_stream._live_encoding_task_ref.cancel()
                            done, _ = await asyncio.wait(
                                {live_stream._live_encoding_task_ref},
                                timeout=10.0,
                            )
                            if not done:
                                logger.warning(f'[Live: {live_stream.live_stream_id}] Encoding task cleanup did not complete within 10 seconds.')
                            live_stream._live_encoding_task_ref = None

                        self.tuner = live_stream.tuner
                        live_stream.tuner = None
                        found_reusable_tuner = True
                        break

                    if found_reusable_tuner is True:
                        break
                    if should_wait_next_retry is False:
                        break
                    await asyncio.sleep(0.1)

            # エンコードタスクを非同期で実行
            if should_start_task is True:
                instance = LiveEncodingTask(self, self._streaming_config)
                self._live_encoding_task_ref = asyncio.create_task(instance.run())

        # クライアントの登録
        async with self._tuner_lock:
            client = LiveStreamClient(self, client_type)
            self._clients.append(client)
            logger.info(f'[Live: {self.live_stream_id}] Client Connected. Client ID: {client.client_id}')

        # アイドリングからの復帰
        if current_status == 'Idling':
            self.setStatus('ONAir', 'ライブストリームは ONAir です。')

        return client

    def disconnect(self, client: LiveStreamClient) -> None:
        try:
            self._clients.remove(client)
            logger.info(f'[Live: {self.live_stream_id}] Client Disconnected. Client ID: {client.client_id}')
        except ValueError:
            pass
        del client

    def disconnectAll(self) -> None:
        clients = self._clients[:]
        self._clients = []
        for client in clients:
            if client.client_type == 'mpegts':
                client.writeStreamData(None)
            logger.info(f'[Live: {self.live_stream_id}] Client Disconnected. Client ID: {client.client_id}')
            del client

    def getStatus(self) -> LiveStreamStatus:
        return LiveStreamStatus(
            status=self._status,
            detail=self._detail,
            started_at=self._started_at,
            updated_at=self._updated_at,
            client_count=len(self._clients),
        )

    def setStatus(
        self,
        status: Literal['Offline', 'Standby', 'ONAir', 'Idling', 'Restart'],
        detail: str,
        quiet: bool = False,
    ) -> bool:
        if self._status == status and self._detail == detail:
            return False
        if (status == 'Offline' or status == 'Restart') and status == self._status:
            return False
        if self._status == 'Offline' and status == 'Restart':
            return False

        if ((self._status == 'Offline' or self._status == 'Restart') and status == 'Standby'):
            self._started_at = time.time()
            self._stream_data_written_at = time.time()

        if quiet is False:
            logger.info(f'[Live: {self.live_stream_id}] [Status: {status}] {detail}')

        if self._status == 'Standby' and status == 'ONAir':
            logger.info(f'[Live: {self.live_stream_id}] Startup complete. ({round(time.time() - self._started_at, 2)} sec)')

        self._status = status
        self._detail = detail
        self._updated_at = time.time()

        if self.tuner is not None:
            if self._status == 'Idling':
                self.tuner.unlock(self.live_stream_id)
            if self._status == 'ONAir':
                self.tuner.lock(self.live_stream_id)

        return True

    def getStreamDataWrittenAt(self) -> float:
        return self._stream_data_written_at

    async def writeStreamData(self, stream_data: bytes) -> None:
        now = time.time()
        for client in self._clients:
            timeout = 10
            if now - client.stream_data_read_at > timeout:
                self._clients.remove(client)
                logger.info(f'[Live: {self.live_stream_id}] Client Disconnected (Timeout). Client ID: {client.client_id}')
                del client
                continue
            if client.client_type == 'mpegts':
                client.writeStreamData(stream_data)
        if stream_data != b'':
            self._stream_data_written_at = now

    @classmethod
    async def closeAll(cls) -> None:
        """全ライブストリームを停止する (アプリケーション終了時に呼び出す)"""
        for live_stream in list(cls.__instances.values()):
            live_stream.setStatus('Offline', 'アプリケーションが終了しています。')
            live_stream.disconnectAll()
            if live_stream._live_encoding_task_ref is not None:
                live_stream._live_encoding_task_ref.cancel()
                try:
                    await asyncio.wait_for(live_stream._live_encoding_task_ref, timeout=5.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
                live_stream._live_encoding_task_ref = None
            if live_stream.tuner is not None:
                await live_stream.tuner.close(live_stream.live_stream_id, force=True)
                live_stream.tuner = None
        await EDCBTuner.closeAll()
        cls.__instances.clear()
