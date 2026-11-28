"""音楽の見た目用データ（波形とスペクトラム）を先に作っておく。

再生中に Web Audio の AnalyserNode で解析する手もあるが、それをやると音声が
AudioContext 経由になる。iOS は背景に回ると AudioContext を止めるので、
PiP にしたまま画面を消して聴く（音楽再生の主目的）が壊れかねない。
音の通り道には触らず、先に解析した数値を再生位置に合わせて描くだけにする。

出力は1ファイル（<再生用MP4>.audioviz.bin）:
    4バイト … ヘッダ(JSON)の長さ, リトルエンディアン
    JSON   … {'version','duration','fps','bands','peak_count'}
    uint8  … 波形のピーク peak_count 個（シークバーの背景用）
    uint8  … スペクトラム bands×フレーム数（時間順に bands 個ずつ）
"""

import json
import logging
import os
import struct
import subprocess

import numpy as np

from logic.frame_sync.xcorr import nice_kwargs

logger = logging.getLogger(__name__)

RATE = 11025          # 解析用の標本化周波数。音楽の見た目にはこれで十分（5.5kHz まで見える）
WIN = 1024            # FFT 窓
FPS = 12.5            # スペクトラムのコマ数/秒
BANDS = 24            # 帯域の数（対数間隔）
PEAKS = 600           # シークバーに敷く波形の点数
DB_RANGE = 48.0       # スペクトラムの表示幅(dB)。曲中の最大からここまで下を描く
SUFFIX = '.audioviz.bin'
NICE = 10


VERSION = 2           # 中身の作り方を変えたら上げる（古いものは作り直す）


def is_current(path: str) -> bool:
    """出来ている解析データが今の版か。古ければ作り直す。"""
    try:
        with open(path, 'rb') as f:
            n = struct.unpack('<I', f.read(4))[0]
            head = json.loads(f.read(n))
    except Exception:
        return False
    return head.get('version') == VERSION


def viz_path(play_mp4: str) -> str:
    # 付随ファイルは <stem>.xxx で揃える（再配置/削除がまとめて面倒を見る）
    return os.path.splitext(play_mp4)[0] + SUFFIX


def _decode(ffmpeg: str, path: str, nice=NICE) -> np.ndarray:
    """モノラル float32 に落とす（見た目用なので低い標本化周波数で十分）。"""
    r = subprocess.run(
        [ffmpeg, '-nostdin', '-v', 'error', '-i', path, '-vn', '-ac', '1',
         '-ar', str(RATE), '-f', 'f32le', '-'],
        capture_output=True, timeout=600, **nice_kwargs(nice))
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f'音声を読めませんでした: {(r.stderr or b"").decode()[:200]}')
    return np.frombuffer(r.stdout, dtype=np.float32)


def _band_edges() -> np.ndarray:
    """対数間隔の帯域境界（FFT のビン番号）。低い方を細かく見る＝耳の感じ方に近い。"""
    lo, hi = 40.0, RATE / 2.0
    freqs = np.geomspace(lo, hi, BANDS + 1)
    return np.clip((freqs / (RATE / WIN)).astype(int), 1, WIN // 2)


def analyze(ffmpeg: str, path: str, nice=NICE) -> bytes:
    """再生用MP4（or 任意の音源）から波形とスペクトラムを作る。"""
    x = _decode(ffmpeg, path, nice=nice)
    n = len(x)
    duration = n / RATE if n else 0.0

    # 波形: 区間ごとの実効値(RMS)。最大振幅で採ると、今の音楽はほぼ全区間が振り切れて
    # 真っ平らな帯になってしまう（実測: 平均 245/255）。曲の中の相対値として出す
    peaks = np.zeros(PEAKS, dtype=np.uint8)
    if n:
        idx = np.linspace(0, n, PEAKS + 1).astype(int)
        rms = np.zeros(PEAKS, dtype=np.float32)
        for i in range(PEAKS):
            seg = x[idx[i]:idx[i + 1]]
            if seg.size:
                rms[i] = float(np.sqrt(np.mean(seg.astype(np.float32) ** 2)))
        # 曲の中の下位20%〜上位99%を 0..1 に引き伸ばす。今の音楽は圧縮が強く、
        # 0 を基準に採るとほぼ全区間が同じ高さの塊になって起伏が読めない
        # （実測: 線形だと平均 245/255）。一瞬のピークにも引っ張られないよう上は99%で採る
        lo, hi = float(np.percentile(rms, 20)), float(np.percentile(rms, 99))
        span = max(hi - lo, 1e-9)
        peaks = np.clip((rms - lo) / span * 0.85 + 0.12, 0, 1)
        peaks = (peaks * 255).astype(np.uint8)

    # スペクトラム: 窓をずらしながら FFT し、対数間隔の帯域へまとめる
    hop = max(1, int(RATE / FPS))
    frames = max(0, 1 + (n - WIN) // hop) if n >= WIN else 0
    edges = _band_edges()
    out = np.zeros((frames, BANDS), dtype=np.uint8)
    if frames:
        win = np.hanning(WIN).astype(np.float32)
        # 一度に全部 FFT すると 4分の曲で 3000×1024 の複素配列になるが、
        # それでも 50MB 程度で収まるので分割せず素直に回す
        starts = np.arange(frames) * hop
        block = np.lib.stride_tricks.sliding_window_view(x, WIN)[starts] * win
        mag = np.abs(np.fft.rfft(block, axis=1))
        band_db = np.zeros((frames, BANDS), dtype=np.float32)
        for b in range(BANDS):
            s, e = edges[b], max(edges[b] + 1, edges[b + 1])
            band_db[:, b] = 20 * np.log10(np.maximum(mag[:, s:e].mean(axis=1), 1e-6))
        # その曲の中での相対値にする。絶対値で切ると、今の音楽はほぼ全部が上限に
        # 張り付いて真っ黒な塊になる（実測: 平均 248/255）。上位0.5%を 0dB とみなし、
        # そこから DB_RANGE 下までを 0..255 に伸ばす
        ref = float(np.percentile(band_db, 99.5))
        out[:] = np.clip((band_db - ref + DB_RANGE) / DB_RANGE * 255, 0, 255).astype(np.uint8)

    head = json.dumps({'version': VERSION, 'duration': round(duration, 3), 'fps': FPS,
                       'bands': BANDS, 'peak_count': PEAKS}).encode()
    return struct.pack('<I', len(head)) + head + peaks.tobytes() + out.tobytes()


def build(ffmpeg: str, play_mp4: str, nice=NICE) -> str:
    """<再生用MP4>.audioviz.bin を作って置き場所を返す。"""
    out = viz_path(play_mp4)
    data = analyze(ffmpeg, play_mp4, nice=nice)
    tmp = out + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, out)
    return out
