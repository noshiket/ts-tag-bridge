"""映像の突き合わせの材料（灰色のコマ・相関・差の並び・鮮明さ・ずれ）"""

import subprocess
import numpy as np
from .refine import _CROP, _GRID_FPS, _MAX_LAG, _SCAN_FRAMES, _SIZE, logger
from .xcorr import nice_kwargs


def _frames_gray(path, sec, n=1, ffmpeg='ffmpeg', nice=0):
    """sec から n 枚を、中央切り出し＋低解像度のグレースケールで取り出す。

    エンコード済み mp4 は可変フレームレート(実測 平均25.2fps、1フレームの間隔が
    4004〜8008/120000 秒と混在)なので、素の連番フレームでは時刻が分からない。
    fps フィルタで 30fps の等間隔グリッドに直してから取り、i 枚目を sec+i/30 秒とみなす。
    """
    # 数秒ぶんしか取らないので1スレッドで十分。CM解析と食い合わないよう優先度も下げる
    cmd = [ffmpeg, '-v', 'error', '-threads', '1', '-ss', f'{max(0.0, sec):.3f}', '-i', path,
           '-vf', f'fps={_GRID_FPS},{_CROP},scale={_SIZE}:{_SIZE},format=gray',
           '-frames:v', str(n), '-f', 'rawvideo', '-']
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=120,
                             **nice_kwargs(nice)).stdout
    except (subprocess.SubprocessError, OSError) as e:
        logger.warning('frame_sync: フレーム取得に失敗 %s@%.3f: %s', path, sec, e)
        return []
    px = _SIZE * _SIZE
    return [np.frombuffer(raw[i * px:(i + 1) * px], np.uint8).astype(np.float32)
            for i in range(len(raw) // px)]


def _frame_gray(path, sec, ffmpeg='ffmpeg', nice=0):
    f = _frames_gray(path, sec, 1, ffmpeg, nice)
    return f[0] if f else None


def _ncc(x, y):
    """正規化相互相関。明るさ・コントラストの差を吸収する。"""
    x = x - x.mean()
    y = y - y.mean()
    n = float(np.linalg.norm(x) * np.linalg.norm(y))
    return float(x @ y / n) if n else 0.0


def _diff_series(frames):
    """隣り合うフレームの差の系列。「いつ絵が変わったか」だけを取り出す。"""
    return np.array([float(np.abs(frames[i + 1] - frames[i]).mean())
                     for i in range(len(frames) - 1)])


def _sharpness(d):
    """系列の山の鋭さ(最大 ÷ それ以外の中央値)。

    場面の切り替わりがあると大きくなる。なだらかな動きだけの場所では 1 に近い。
    """
    if len(d) < 3:
        return 0.0
    k = int(np.argmax(d))
    med = float(np.median(np.delete(d, k)))
    return float(d[k] / med) if med > 1e-6 else (0.0 if d[k] < 1e-6 else 999.0)


def _best_lag(da, db, maxlag=_MAX_LAG):
    """差の系列同士を突き合わせ、B が A より何フレーム遅れているかと相関を返す。"""
    da, db = da - da.mean(), db - db.mean()
    best, best_lag = -2.0, 0
    for lag in range(-maxlag, maxlag + 1):
        x, y = (da[:len(da) - lag], db[lag:]) if lag >= 0 else (da[-lag:], db[:len(db) + lag])
        if len(x) < 10:
            continue
        n = float(np.linalg.norm(x) * np.linalg.norm(y))
        s = float(x @ y / n) if n else 0.0
        if s > best:
            best, best_lag = s, lag
    return best_lag, best


def _check_at(path_a, path_b, sec, offset, ffmpeg, frames=None, nice=0):
    """sec 付近で、映像のずれが音声のずれと同じかをフレーム単位で測る。

    A と B の絵を直接照合するのではなく、**それぞれの中で「いつ絵が変わったか」の
    系列**を作って突き合わせる。絵の中身ではなく変化の時刻を見るので、

      - L字テロップで本編が縮小・移動していても効く
        (実測 vdb=14308 かえでテレビ版[L字] 対 15713 BSアニメX版: 絵の照合だと
         一致度 -0.05〜0.66 で全点棄却になるが、この方法なら全点 +1フレームで一致)
      - 片方だけ CM が残っている等で内容が違えば相関が落ちるので弾ける
        (実測: 内容が合っていれば 0.64〜0.99、ずらして内容を変えると 0.15〜0.45)

    同じ手順を両方に掛けるため、片方だけに効く偏りも乗らない。
    """
    n = frames or _SCAN_FRAMES
    fa = _frames_gray(path_a, sec, n, ffmpeg, nice)
    fb = _frames_gray(path_b, sec - offset, n, ffmpeg, nice)
    if len(fa) < n or len(fb) < n:
        return None
    da, db = _diff_series(fa), _diff_series(fb)
    lag, corr = _best_lag(da, db)
    return {
        'sec': round(sec, 3),
        'frame_offset': lag,                        # +なら映像は音声より遅れている
        'score': round(corr, 3),                    # 変化の系列の一致度
        'contrast': round(min(_sharpness(da), _sharpness(db)), 1),
    }
