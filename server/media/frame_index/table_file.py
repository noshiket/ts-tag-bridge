"""フレーム表のファイル（書く・読む・差分の詰め方・置き場所）"""

import gzip
import os
import struct
from typing import List, Optional
from .lookup import _INT32_MAX, _INT32_MIN


_MAGIC = b'FIDX'


_VERSION = 5      # v2: halfDelay / v3: 主音声PESのPTS表 / v4: TOT表 / v5: 差分を64bitにも置ける


_VERSIONS_READ = (4, 5)   # 読める版。v4 の既存キャッシュはそのまま使う


def _pack_deltas(values):
    """差分列を詰める。int32 に収まらない値があれば 64bit へ落とす。

    PTS は 33bit で周回するので、周回をまたぐと差分が -2^33 になり int32 に入らない
    （実測: 5時間の録画で 'i' format requires ... と落ち、フレーム表も CM解析も
    作られないままになっていた）。1バイトの印を先に置いて、読む側が判別する。
    """
    wide = any(v < _INT32_MIN or v > _INT32_MAX for v in values)
    head = struct.pack('<B', 1 if wide else 0)
    if not values:
        return head
    return head + struct.pack(f'<{len(values)}{"q" if wide else "i"}', *values)


def _unpack_deltas(data, pos, count, ver):
    """_pack_deltas の逆。v4 は印が無く常に int32。戻り値は (差分列, 次の位置)。"""
    if ver < 5:
        if count <= 0:
            return (), pos
        return struct.unpack_from(f'<{count}i', data, pos), pos + count * 4
    wide = struct.unpack_from('<B', data, pos)[0]
    pos += 1
    if count <= 0:
        return (), pos
    size = 8 if wide else 4
    fmt = 'q' if wide else 'i'
    return struct.unpack_from(f'<{count}{fmt}', data, pos), pos + count * size


def frame_index_path(rec_id: int, data_dir: str) -> str:
    return os.path.join(data_dir, 'frame_index', f'{int(rec_id)}.fidx.gz')


def save_frame_table(path: str, frames: List[int], first_pts: int,
                     half: Optional[List[bool]] = None,
                     audio_pid: Optional[int] = None,
                     audio_pts: Optional[List[int]] = None,
                     tot_entries=None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = len(frames)
    buf = bytearray(struct.pack('<4sHqq', _MAGIC, _VERSION, int(first_pts), n))
    if n:
        buf += struct.pack('<q', int(frames[0]))
        if n > 1:
            buf += _pack_deltas([frames[i] - frames[i - 1] for i in range(1, n)])
        # halfDelay は 1 フレーム 1 ビット。プルダウン以外はほぼ全部 0 なので gzip で消える
        bits = bytearray((n + 7) // 8)
        for i, v in enumerate(half or ()):
            if v:
                bits[i >> 3] |= 1 << (i & 7)
        buf += bits
    # v3: 主音声PESのPTS表。差分は 1920 か 3840 が並ぶだけなので gzip でほぼ消える
    ap = audio_pts or []
    buf += struct.pack('<iq', -1 if audio_pid is None else int(audio_pid), len(ap))
    if ap:
        buf += struct.pack('<q', int(ap[0]))
        if len(ap) > 1:
            buf += _pack_deltas([ap[i] - ap[i - 1] for i in range(1, len(ap))])
    # v4: TOT表 [(実時刻, そのとき直近の映像PTS)]。30分番組で 300〜400 件しかない。
    # トリム・分割で相対時刻が変わっても動かない唯一の基準
    te = tot_entries or []
    buf += struct.pack('<q', len(te))
    for dt, pts in te:
        buf += struct.pack('<qq', int(dt.timestamp()), int(pts))
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wb') as f:
        f.write(buf)
    os.replace(tmp, path)


def load_frame_table(path: str, with_half: bool = False, with_audio: bool = False,
                     with_tot: bool = False):
    """(frames, first_pts) を返す。フォーマット不整合時は ValueError。

    with_half=True なら (frames, first_pts, halfDelay)。
    with_audio=True なら さらに (audio_pid, audioPES_PTS) が付く。
    with_tot=True なら さらに totEntries [(datetime, 映像PTS)] が付く。
    """
    with gzip.open(path, 'rb') as f:
        data = f.read()
    magic, ver, first_pts, n = struct.unpack_from('<4sHqq', data, 0)
    if magic != _MAGIC or ver not in _VERSIONS_READ:
        raise ValueError(f'frame_index フォーマット不整合: {path}')
    pos = struct.calcsize('<4sHqq')
    frames: List[int] = []
    if n:
        base = struct.unpack_from('<q', data, pos)[0]
        pos += 8
        frames.append(base)
        if n > 1:
            deltas, pos = _unpack_deltas(data, pos, n - 1, ver)
            acc = base
            for d in deltas:
                acc += d
                frames.append(acc)
    if not with_half and not with_audio and not with_tot:
        return frames, first_pts
    nb = (n + 7) // 8 if n else 0
    if len(data) - pos < nb:
        raise ValueError(f'frame_index に halfDelay がありません: {path}')
    bits = data[pos:pos + nb]
    half = [bool(bits[i >> 3] & (1 << (i & 7))) for i in range(n)]
    pos += nb
    if not with_audio and not with_tot:
        return frames, first_pts, half
    apid, na = struct.unpack_from('<iq', data, pos)
    pos += struct.calcsize('<iq')
    apts: List[int] = []
    if na:
        base = struct.unpack_from('<q', data, pos)[0]
        pos += 8
        apts.append(base)
        if na > 1:
            adeltas, pos = _unpack_deltas(data, pos, na - 1, ver)
            acc = base
            for d in adeltas:
                acc += d
                apts.append(acc)
    ret = (frames, first_pts, half, (None if apid < 0 else apid), apts)
    if not with_tot:
        return ret
    from datetime import datetime
    nt = struct.unpack_from('<q', data, pos)[0]
    pos += 8
    tots = []
    for i in range(nt):
        ts_, p_ = struct.unpack_from('<qq', data, pos + i * 16)
        tots.append((datetime.fromtimestamp(ts_), p_))
    return ret + (tots,)
