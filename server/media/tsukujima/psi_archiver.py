# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

import asyncio
import logging
from collections.abc import AsyncGenerator, Coroutine
from typing import Any

from .quality import LIBRARY_PATH

logger = logging.getLogger(__name__)


class LivePSIDataArchiver:

    def __init__(self, service_id: int) -> None:
        self.service_id = service_id
        self._psisiarc_processes: list[asyncio.subprocess.Process] = []

    async def pushTSPacketData(self, packet: bytes) -> None:
        tasks: list[Coroutine[Any, Any, None]] = []
        for psisiarc_process in self._psisiarc_processes:
            assert type(psisiarc_process.stdin) is asyncio.StreamWriter
            if psisiarc_process.stdin.is_closing():
                continue
            psisiarc_process.stdin.write(packet)
            tasks.append(psisiarc_process.stdin.drain())
        await asyncio.gather(*tasks, return_exceptions=True)

    async def getPSIArchivedData(self) -> AsyncGenerator[bytes, None]:
        psisiarc_options = [
            '-r', 'arib-data',
            '-n', str(self.service_id),
            '-i', '1',
            '-',
            '-',
        ]

        psisiarc_process = await asyncio.subprocess.create_subprocess_exec(
            *[LIBRARY_PATH['psisiarc'], *psisiarc_options],
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        self._psisiarc_processes.append(psisiarc_process)
        logger.debug(f'[LivePSIDataArchiver] psisiarc started. (PID: {psisiarc_process.pid})')

        trailer_size: int = 0
        try:
            while True:
                result = await self.__readPSIArchivedDataChunk(psisiarc_process, trailer_size)
                if result is None:
                    break
                psi_archive, trailer_size = result
                yield psi_archive
        finally:
            if psisiarc_process.returncode is None:
                psisiarc_process.kill()
            if psisiarc_process in self._psisiarc_processes:
                self._psisiarc_processes.remove(psisiarc_process)
            logger.debug(f'[LivePSIDataArchiver] psisiarc terminated. (PID: {psisiarc_process.pid})')

    def destroy(self) -> None:
        for psisiarc_process in self._psisiarc_processes:
            psisiarc_process.kill()
        self._psisiarc_processes.clear()

    @staticmethod
    async def __readPSIArchivedDataChunk(
        psisiarc_process: asyncio.subprocess.Process,
        trailer_size: int,
    ) -> tuple[bytes, int] | None:
        """
        psisiarc からの出力ストリームから PSI/SI アーカイブデータ (.psc) を適切に読み取る
        ref: https://github.com/xtne6f/EDCB/blob/work-plus-s-230212/ini/HttpPublic/legacy/view.lua#L128-L160
        """

        def get_le_number(buffer: bytes, pos: int, length: int) -> int:
            return int.from_bytes(buffer[pos:pos + length], byteorder='little')

        assert type(psisiarc_process.stdout) is asyncio.StreamReader

        try:
            if trailer_size > 0:
                buffer = await psisiarc_process.stdout.readexactly(trailer_size)
                if len(buffer) != trailer_size:
                    return None

            buffer = await psisiarc_process.stdout.readexactly(32)
            if len(buffer) != 32:
                return None

            time_list_len = get_le_number(buffer, 10, 2)
            dictionary_len = get_le_number(buffer, 12, 2)
            dictionary_data_size = get_le_number(buffer, 16, 4)
            code_list_len = get_le_number(buffer, 24, 4)
            payload = b''
            payload_size = (time_list_len * 4 + dictionary_len * 2
                           + ((dictionary_data_size + 1) // 2) * 2
                           + code_list_len * 2)

            if payload_size > 0:
                payload = await psisiarc_process.stdout.readexactly(payload_size)
                if len(payload) != payload_size:
                    return None

            buffer = b'=' * trailer_size + buffer + payload
            return (buffer, 2 + (2 + len(payload)) % 4)

        except asyncio.IncompleteReadError:
            return None
