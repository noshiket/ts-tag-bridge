# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

import asyncio
import datetime
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal
from urllib.parse import urlparse

from .ctrl_cmd import CtrlCmdUtil
from .edcb_types import ChSet5Item
from .pipe_reader import PipeStreamReader


class EDCBUtil:
    """
    EDCB に関連する雑多なユーティリティ
    ref: https://github.com/xtne6f/edcb.py/blob/master/edcb.py
    """

    @staticmethod
    def getEDCBHost(tcp_url: str) -> str | None:
        parsed = urlparse(tcp_url)
        return parsed.hostname

    @staticmethod
    def getEDCBPort(tcp_url: str) -> int | None:
        parsed = urlparse(tcp_url)
        return parsed.port or 4510

    @staticmethod
    async def getEDCBStatus(tcp_url: str) -> Literal['Normal', 'Recording', 'EPGGathering', 'Unknown']:
        edcb = CtrlCmdUtil(tcp_url)
        edcb.setConnectTimeOutSec(5)
        result = await edcb.sendGetNotifySrvStatus()
        if result is None:
            return 'Unknown'
        if result['param1'] == 0:
            return 'Normal'
        elif result['param1'] == 1:
            return 'Recording'
        elif result['param1'] == 2:
            return 'EPGGathering'
        return 'Unknown'

    @staticmethod
    def convertBytesToString(buffer: bytes | bytearray | memoryview, default_encoding: str = 'cp932') -> str:
        if len(buffer) == 0:
            return ''
        elif len(buffer) >= 2 and buffer[0] == 0xff and buffer[1] == 0xfe:
            return str(memoryview(buffer)[2:], 'utf_16_le', 'replace')
        elif len(buffer) >= 3 and buffer[0] == 0xef and buffer[1] == 0xbb and buffer[2] == 0xbf:
            return str(memoryview(buffer)[3:], 'utf_8', 'replace')
        else:
            try:
                return str(buffer, 'utf_8', 'strict')
            except UnicodeDecodeError:
                return str(buffer, default_encoding, 'replace')

    @staticmethod
    def parseChSet5(chset5_txt: str) -> list[ChSet5Item]:
        result: list[ChSet5Item] = []
        for line in chset5_txt.splitlines():
            field = line.split('\t')
            if len(field) >= 9:
                try:
                    result.append({
                        'service_name': field[0],
                        'network_name': field[1],
                        'onid': int(field[2]),
                        'tsid': int(field[3]),
                        'sid': int(field[4]),
                        'service_type': int(field[5]),
                        'partial_flag': int(field[6]) != 0,
                        'epg_cap_flag': int(field[7]) != 0,
                        'search_flag': int(field[8]) != 0,
                        'remocon_id': int(field[9]) if len(field) >= 10 else 0,
                    })
                except Exception:
                    pass
        return result

    @staticmethod
    def parseProgramExtendedText(extended_text: str) -> dict[str, str]:
        extended_text = extended_text.replace('\r', '')
        result: dict[str, str] = {}
        head = ''
        i = 0
        while True:
            if i == 0 and extended_text.startswith('- '):
                j = 2
            elif (j := extended_text.find('\n- ', i)) >= 0:
                while head in result:
                    head += '\t'
                result[head] = extended_text[(0 if i == 0 else i + 1):j + 1]
                j += 3
            else:
                if len(extended_text) != 0:
                    while head in result:
                        head += '\t'
                    result[head] = extended_text[(0 if i == 0 else i + 1):]
                break
            i = extended_text.find('\n', j)
            if i < 0:
                head = extended_text[j:]
                while head in result:
                    head += '\t'
                result[head] = ''
                break
            head = extended_text[j:i]
        return result

    @staticmethod
    def datetimeToFileTime(dt: datetime.datetime, tz: datetime.timezone = datetime.UTC) -> int:
        return int((dt.timestamp() + tz.utcoffset(None).total_seconds()) * 10000000) + 116444736000000000

    @staticmethod
    async def openViewStream(process_id: int, tcp_url: str, timeout_sec: float = 10.0) -> tuple[asyncio.StreamReader, asyncio.StreamWriter] | None:
        """
        View アプリの SrvPipe ストリームの転送を開始する

        Args:
            process_id: 対象 View プロセス ID
            tcp_url: EDCB CtrlCmd 接続先 URL
            timeout_sec: 接続試行のタイムアウト秒数
        """
        edcb = CtrlCmdUtil(tcp_url)
        edcb.setConnectTimeOutSec(timeout_sec)
        to = time.monotonic() + timeout_sec
        wait = 0.1
        while time.monotonic() < to:
            reader_and_writer = await edcb.openViewStream(process_id)
            if reader_and_writer is not None:
                return reader_and_writer
            await asyncio.sleep(wait)
            wait = min(wait + 0.1, 1.0)
        return None

    @staticmethod
    async def openPipeStream(process_id: int, buffering: int = -1, timeout_sec: float = 10.0, dir: str | None = None) -> PipeStreamReader | None:
        """
        システムに存在する SrvPipe ストリームを開き、PipeStreamReader を返す
        """
        to = time.monotonic() + timeout_sec
        wait = 0.1
        while time.monotonic() < to:
            for port in range(30):
                pipe = None
                for index in range(2):
                    try:
                        if sys.platform == 'win32':
                            path = ('\\\\.\\pipe\\' if dir is None else dir) + 'SendTSTCP_' + str(port) + '_' + str(process_id)
                            pipe = await asyncio.to_thread(open, path, mode='rb', buffering=buffering)
                            return PipeStreamReader(pipe, ThreadPoolExecutor())
                        else:
                            path = ('/var/local/edcb/' if dir is None else dir) + 'SendTSTCP_' + str(port) + '_' + str(process_id) + '_' + str(index) + '.fifo'
                            pipe = await asyncio.to_thread(open, path, mode='rb', buffering=buffering)
                    except Exception:
                        break
                    assert sys.platform != 'win32'
                    import fcntl
                    try:
                        fcntl.flock(pipe.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                        return PipeStreamReader(pipe, ThreadPoolExecutor())
                    except Exception:
                        pipe.close()
                if pipe is not None:
                    break
            await asyncio.sleep(wait)
            wait = min(wait + 0.1, 1.0)
        return None
