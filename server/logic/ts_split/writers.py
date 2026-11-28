"""区間で分ける時の書き出し（区間ごとのファイルに溜めて書く・終わった区間を閉じる・残りを閉じる）と PCR の読み取り。

split_ts と split_ts_corrected で共通。パケットごとの判定は呼ぶ側に置き（速さのため）、ここは
バッファの吐き出しと閉じる時の扱いだけを持つ。
"""

import os
from typing import List, Optional

from read_tsprogram.constants import TS_PACKET_SIZE
from .output import open_segment_output

WRITE_BUF_SIZE = TS_PACKET_SIZE * 512   # ~96KB


def read_pcr(raw) -> Optional[int]:
    """PCR を持つパケットならその値（27MHz）、持たなければ None。"""
    afc = (raw[3] >> 4) & 0x3
    if afc in (0b10, 0b11) and raw[4] >= 7 and (raw[5] & 0x10):
        b = raw[6:12]
        base = (b[0] << 25) | (b[1] << 17) | (b[2] << 9) | (b[3] << 1) | (b[4] >> 7)
        return base * 300 + (((b[4] & 1) << 8) | b[5])
    return None


class SegmentWriters:
    """区間ごとの出力ファイル。handles[i] が None なら閉じた（または開く前）。"""

    def __init__(self, segments, output_dir: str, info, verbose: bool):
        n = len(segments)
        self.handles: List[Optional[object]] = [None] * n
        self.paths: List[str] = [''] * n
        self.bufs: List[bytearray] = [bytearray() for _ in segments]
        self.done: List[bool] = [False] * n
        self._segments, self._output_dir, self._info = segments, output_dir, info
        self._verbose = verbose

    def open_all(self) -> None:
        """全区間のファイルを作り、PAT/PMT を書く。"""
        for i, seg in enumerate(self._segments):
            self.paths[i], self.handles[i] = open_segment_output(seg, self._output_dir, self._info)

    def flush(self, i: int) -> None:
        self.handles[i].write(self.bufs[i])
        self.bufs[i].clear()

    def finish(self, i: int, message: str) -> None:
        """区間 i を書き終えて閉じる。message は {n}（1始まり）・{path}・{mb} を埋めて出す。"""
        if self.bufs[i]:
            self.flush(i)
        self.handles[i].close()
        self.handles[i] = None
        self.done[i] = True
        if self._verbose:
            size_mb = os.path.getsize(self.paths[i]) / (1024 * 1024)
            print(message.format(n=i + 1, path=self.paths[i], mb=size_mb), flush=True)

    def finish_rest(self, message: str) -> None:
        """ファイルの終わりまで来た時、まだ開いている区間を閉じる。"""
        for i, fh in enumerate(self.handles):
            if fh is not None and not self.done[i]:
                self.finish(i, message)

    def close_all(self) -> None:
        """途中で止まっても、溜めた分を書いてファイルを閉じる（finally で呼ぶ）。"""
        for i, fh in enumerate(self.handles):
            if fh is not None:
                try:
                    if self.bufs[i]:
                        fh.write(self.bufs[i])
                    fh.close()
                except Exception:
                    pass
