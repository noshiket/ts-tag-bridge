"""作業の場所の扱い（裏の I/O を控えめに・古い一時フォルダの片付け・空き容量）"""

import glob as _glob
import os
import shutil
import time
from logic.storage.mount_point import get_mount_point
from ..common import logger


# ioprio_set(2) の番号（x86_64）。IOPRIO_WHO_PROCESS=1、IOPRIO_CLASS_IDLE=3。
_IOPRIO_SET = 251


_IOPRIO_WHO_PROCESS = 1


_IOPRIO_CLASS_IDLE = 3


def set_thread_io_idle() -> bool:
    """このスレッドのディスクI/O優先度を idle にする。できなければ False。

    TS の分割はサーバープロセスの中で数GBを読み書きするため、録画の書き込みと
    同じディスクだと競合してドロップを起こす。外部プロセスなら ionice を前に
    付ければ済むが、ここは自前の処理なので直接下げる。

    実測: エンコード開始直前（＝分割中）の 20:16:19〜23 に、
    BS98 と映画ch という**別チューナー**で同時にパケットロスが出た。
    受信ではなくシステム側の競合であることがこれではっきりしている。
    """
    try:
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        # ioprio の値は (クラス << 13) | 優先度。idle は優先度を持たない
        val = _IOPRIO_CLASS_IDLE << 13
        rc = libc.syscall(_IOPRIO_SET, _IOPRIO_WHO_PROCESS, 0, val)
        if rc != 0:
            return False
        return True
    except Exception:
        return False


def _open_paths() -> set:
    """いまどれかのプロセスが開いているファイルの実体パス。"""
    out = set()
    for d in _glob.glob('/proc/[0-9]*/fd/*'):
        try:
            out.add(os.readlink(d))
        except OSError:
            continue
    return out


def cleanup_orphan_tmp(min_age_sec: int = 3600, tmp_dir: str = '/tmp') -> int:
    """Amatsukaze が /tmp に残した中間ファイルを片付ける。解放したバイト数を返す。

    Amatsukaze はコンテナで動くが、ホストの /tmp がそのまま見えているので
    中間ファイル(amt*/ と tmp*.wav)はここに落ちる。異常終了や中止のたびに
    残り、放っておくと溜まって新しいエンコードを道連れにする。

    実測: amt* が 31GB、tmp*.wav が 33GB 残っていて空きが尽き、
    2時間24分かけてエンコードし終わったものが MP4 への多重化で
    "No space left on device" になって失敗した。

    開いているものと、min_age_sec より新しいものは触らない（実行中のぶんを
    巻き込まないため）。
    """
    now = time.time()
    opened = _open_paths()
    freed = 0
    targets = (_glob.glob(os.path.join(tmp_dir, 'amt*'))
               + _glob.glob(os.path.join(tmp_dir, 'tmp*.wav')))
    for path in targets:
        try:
            if now - os.path.getmtime(path) < min_age_sec:
                continue
            if any(o == path or o.startswith(path + os.sep) for o in opened):
                continue
            if os.path.isdir(path):
                size = sum(os.path.getsize(os.path.join(r, f))
                           for r, _, fs in os.walk(path) for f in fs
                           if os.path.exists(os.path.join(r, f)))
                shutil.rmtree(path, ignore_errors=True)
            else:
                size = os.path.getsize(path)
                os.remove(path)
            freed += size
        except OSError:
            continue
    if freed:
        logger.info('/tmp の置き去り中間ファイルを片付けました: %.1fGB', freed / 1024 ** 3)
    return freed


def free_bytes(path: str) -> int:
    """path のあるドライブの空き。path がまだ無ければ、ある所まで親をたどって測る。"""
    probe = path
    while probe and not os.path.exists(probe):
        probe = os.path.dirname(probe)
    return shutil.disk_usage(get_mount_point(probe or '/')).free


def ensure_free_space(path: str, need_bytes: int, label: str) -> str | None:
    """空きが足りなければ理由の文字列を返す。足りていれば None。

    分割時にも同じ確認をしているが、エンコードは何時間も走るので、その間に
    他の処理が食い潰して最後の多重化で溢れることがある（実測）。
    取りかかる直前にもう一度見る。
    """
    try:
        free = free_bytes(path)
    except OSError as e:
        logger.warning('空き容量を確認できません(続行): %s', e)
        return None
    if free >= need_bytes:
        return None
    return (f'{label}の空き容量不足'
            f'（目安 {need_bytes / 1024 ** 3:.1f}GB必要 / 空き {free / 1024 ** 3:.1f}GB）')
