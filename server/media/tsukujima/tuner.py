# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

from __future__ import annotations

import asyncio
import time
from threading import Lock
from typing import ClassVar, Literal, cast

from .edcb_types import SetChInfo
from .ctrl_cmd import CtrlCmdUtil
from .edcb_util import EDCBUtil
from .pipe_reader import PipeStreamReader


EDCBTunerState = Literal['Idle', 'Starting', 'Active', 'Cancelling']


class EDCBTuner:
    """ EDCB バックエンドのチューナーを制御するクラス """

    __instances: ClassVar[list[EDCBTuner]] = []
    __next_networktv_id: ClassVar[int] = 500
    __lock: ClassVar[Lock] = Lock()

    # configure() で設定される EDCB CtrlCmd TCP URL
    _tcp_url: ClassVar[str] = ''

    @classmethod
    def configure(cls, tcp_url: str) -> None:
        """
        クラスレベルで EDCB CtrlCmd TCP URL を設定する
        アプリケーション起動時に一度だけ呼び出すこと

        Args:
            tcp_url: EDCB CtrlCmd 接続先 URL (例: 'tcp://n100dcitx:4510')
        """
        cls._tcp_url = tcp_url

    @classmethod
    def getOrCreate(cls, owner_live_stream_id: str) -> EDCBTuner:
        with cls.__lock:
            for instance in cls.__instances:
                if instance._state == 'Idle' and instance._owner_live_stream_id is None and instance._locked is False:
                    instance._owner_live_stream_id = owner_live_stream_id
                    return instance

            edcb_networktv_id = cls.__next_networktv_id
            cls.__next_networktv_id += 1
            instance = cls(edcb_networktv_id, owner_live_stream_id)
            cls.__instances.append(instance)
            return instance

    def __init__(self, edcb_networktv_id: int, owner_live_stream_id: str) -> None:
        self.network_id: int = 0
        self.service_id: int = 0
        self.transport_stream_id: int = 0
        self._locked: bool = False
        self._edcb_networktv_id: int = edcb_networktv_id
        self._edcb_process_id: int | None = None
        self._edcb_stream_writer: asyncio.StreamWriter | None = None
        self._edcb_stream_reader: asyncio.StreamReader | None = None
        self._edcb_pipe_stream_reader: PipeStreamReader | None = None
        self._state: EDCBTunerState = 'Idle'
        self._owner_live_stream_id: str | None = owner_live_stream_id

    def getEDCBNetworkTVID(self) -> int:
        return self._edcb_networktv_id

    def getState(self) -> EDCBTunerState:
        return self._state

    def setState(self, state: EDCBTunerState) -> None:
        self._state = state

    def _isOwner(self, live_stream_id: str) -> bool:
        return self._owner_live_stream_id == live_stream_id

    async def setChannel(
        self,
        network_id: int,
        service_id: int,
        transport_stream_id: int,
        owner_live_stream_id: str,
    ) -> bool:
        if self._isOwner(owner_live_stream_id) is False:
            return False
        if self._state == 'Cancelling':
            return False

        self.network_id = network_id
        self.service_id = service_id
        self.transport_stream_id = transport_stream_id

        set_ch_info: SetChInfo = {
            'onid': self.network_id,
            'sid': self.service_id,
            'tsid': self.transport_stream_id,
            'space_or_id': self._edcb_networktv_id,
            'ch_or_mode': 2,
            'use_sid': True,
            'use_bon_ch': True,
        }

        self._state = 'Starting'
        set_ch_timeout = time.monotonic() + 5
        while True:
            edcb = CtrlCmdUtil(self._tcp_url)
            self._edcb_process_id = await edcb.sendNwTVIDSetCh(set_ch_info)
            if self._edcb_process_id is not None or time.monotonic() >= set_ch_timeout:
                break
            await asyncio.sleep(0.5)

        if self._edcb_process_id is None:
            self._state = 'Idle'
            return False

        self._state = 'Active'
        return True

    async def connect(self, owner_live_stream_id: str) -> asyncio.StreamReader | PipeStreamReader | None:
        if self._isOwner(owner_live_stream_id) is False:
            return None
        if self._state == 'Cancelling':
            return None
        if self._edcb_process_id is None:
            return None

        stream_reader: asyncio.StreamReader | PipeStreamReader | None = None

        if EDCBUtil.getEDCBHost(self._tcp_url) != 'edcb-namedpipe':
            result = await EDCBUtil.openViewStream(self._edcb_process_id, self._tcp_url)
            stream_reader, stream_writer = (None, None) if result is None else result
        else:
            stream_reader = await EDCBUtil.openPipeStream(self._edcb_process_id)
            stream_writer = None
            self._edcb_pipe_stream_reader = stream_reader

        if stream_reader is None:
            self._state = 'Idle'
            return None

        if stream_writer is not None:
            self._edcb_stream_writer = stream_writer
            self._edcb_stream_reader = cast(asyncio.StreamReader, stream_reader)

        self._state = 'Active'
        return stream_reader

    async def disconnect(self, owner_live_stream_id: str) -> None:
        if self._isOwner(owner_live_stream_id) is False:
            return

        if self._edcb_stream_writer is not None:
            self._edcb_stream_writer.close()
            await self._edcb_stream_writer.wait_closed()
            self._edcb_stream_writer = None
            self._edcb_stream_reader = None
        elif self._edcb_pipe_stream_reader is not None:
            await self._edcb_pipe_stream_reader.close()
            self._edcb_pipe_stream_reader = None

        if self._state != 'Cancelling':
            self._state = 'Idle'

    def isDisconnected(self) -> bool:
        if self._edcb_stream_writer is not None:
            return self._edcb_stream_writer.is_closing()
        if self._edcb_pipe_stream_reader is not None:
            return self._edcb_pipe_stream_reader.is_closing()
        return True

    def lock(self, owner_live_stream_id: str | None) -> bool:
        if owner_live_stream_id is None or self._isOwner(owner_live_stream_id) is False:
            return False
        self._locked = True
        return True

    def unlock(self, owner_live_stream_id: str | None) -> bool:
        if owner_live_stream_id is None or self._isOwner(owner_live_stream_id) is False:
            return False
        self._locked = False
        return True

    def handoff(self, current_owner_live_stream_id: str, next_owner_live_stream_id: str) -> bool:
        if self._isOwner(current_owner_live_stream_id) is False:
            return False
        self._state = 'Idle'
        self._locked = False
        self._owner_live_stream_id = next_owner_live_stream_id
        return True

    async def close(self, owner_live_stream_id: str | None, force: bool = False) -> bool:
        if force is False and (owner_live_stream_id is None or self._isOwner(owner_live_stream_id) is False):
            return False

        edcb = CtrlCmdUtil(self._tcp_url)
        result = await edcb.sendNwTVIDClose(self._edcb_networktv_id)

        self._edcb_process_id = None
        self._edcb_stream_writer = None
        self._edcb_stream_reader = None
        self._edcb_pipe_stream_reader = None
        self._state = 'Idle'
        self._owner_live_stream_id = None
        self._locked = False

        if self in EDCBTuner.__instances:
            EDCBTuner.__instances.remove(self)

        return result

    @classmethod
    async def closeAll(cls) -> None:
        for instance in list(cls.__instances):
            await instance.close(instance._owner_live_stream_id, force=True)
