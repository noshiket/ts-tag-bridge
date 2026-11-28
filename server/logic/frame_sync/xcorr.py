"""音のずれを詰める道具（優先度・負荷待ち・相互相関・段差の二分探索）"""

import os
import subprocess
import time
import numpy as np

SR = 16000                  # audio_overlap.extract_audio と揃える
_WINDOW_SEC = 4.0           # 1回の相互相関に使う長さ
_MAX_SHIFT_SEC = 1.0        # 探すずれの範囲(粗い区間のずれからの差)


def nice_kwargs(nice):
    """子プロセスの優先度を下げる Popen 引数（logic.cmcut._nice_kwargs と同じ）。"""
    if not nice:
        return {}
    if hasattr(os, 'nice'):                     # POSIX
        return {'preexec_fn': lambda: os.nice(int(nice))}
    flag = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', None)   # Windows
    return {'creationflags': flag} if flag else {}


def throttle(max_load):
    """負荷が高い間だけ少し待つ。待った秒数を返す。

    CM解析（録画登録時に走る。nice=10 だが numba で CPU を使い切る）と時間帯が
    重なることがあるので、こちらは急がない代わりに譲る。処理の切れ目ごとに呼ぶ。
    """
    if not max_load or not hasattr(os, 'getloadavg'):
        return 0.0
    try:
        load = os.getloadavg()[0]
    except OSError:
        return 0.0
    if load <= max_load:
        return 0.0
    wait = min(3.0, (load - max_load) * 0.5)    # 超過分に比例、1回あたり最大3秒
    time.sleep(wait)
    return wait


def _xcorr_offset(ya, yb, center_sec, window_sec=_WINDOW_SEC, max_shift_sec=_MAX_SHIFT_SEC,
                  base_offset=0.0):
    """center_sec 付近での「B の時刻 - A の時刻」(秒)と相関を返す。

    ya の窓を yb の上で滑らせ、正規化相互相関が最大になる位置を探す。
    音量が違っても効くよう、b 側は窓ごとのノルムで割る。
    base_offset は探索の中心(粗いずれ)で、返す値はそれを含んだ絶対のずれ。
    """
    c = int(center_sec * SR)
    half = int(window_sec * SR / 2)
    m = int(max_shift_sec * SR)
    cb = int((center_sec + base_offset) * SR)

    # 切り出しの起点を実際の値で持つ。端で clamp されるとずれるため
    astart = max(0, c - half)
    bstart = max(0, cb - half - m)
    a = ya[astart:c + half]
    b = yb[bstart:cb + half + m]
    if len(a) < SR or len(b) <= len(a):
        return None, 0.0
    a = a - a.mean()
    na = float(np.linalg.norm(a))
    if na == 0.0:
        return None, 0.0

    corr = np.correlate(b, a, mode='valid')
    win = np.ones(len(a), dtype=b.dtype)
    s1 = np.convolve(b, win, 'valid')
    s2 = np.convolve(b * b, win, 'valid')
    nb = np.sqrt(np.maximum(s2 - s1 * s1 / len(a), 1e-9))
    score = corr / (na * nb)

    k = int(np.argmax(score))
    return ((bstart + k) - astart) / SR, float(score[k])


def _runs(probes, tol_sec):
    """[(秒, ずれ)] を、ずれが揃っている連続run に切る。

    共通区間の途中で CM カット位置の違いによる段差が入ることがある(実測: 122-667秒の
    区間の終盤で +46.1ms → +151.6ms)。1区間1オフセットで通すと段差の手前側が
    100ms ずれるので、run ごとに分けて扱う。
    """
    out = []
    for t, off in probes:
        if out and abs(off - out[-1][-1][1]) <= tol_sec:
            out[-1].append((t, off))
        else:
            out.append([(t, off)])
    return out


def _bisect_step(ya, yb, t_lo, t_hi, off_lo, base, tol_sec, min_corr, depth=6):
    """ずれが off_lo から変わる位置を二分探索で詰める(A の秒)。"""
    for _ in range(depth):
        if t_hi - t_lo < 0.5:
            break
        mid = (t_lo + t_hi) / 2
        off, sc = _xcorr_offset(ya, yb, mid, base_offset=base)
        if off is None or sc < min_corr:
            break
        if abs(-off - off_lo) <= tol_sec:
            t_lo = mid
        else:
            t_hi = mid
    return (t_lo + t_hi) / 2
