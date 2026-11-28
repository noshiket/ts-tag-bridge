"""音声の抽出と特徴量（MFCC）・粗探索のハッシュ・相関"""

import os
import subprocess
import wave
import numpy as np

from .mfcc import _compute_features


# ============================
# ffmpegで音声抽出
# ============================
class _keep_dir:
    """with で使えるが消さないディレクトリ。抽出した wav を後段と共有するため。"""

    def __init__(self, path):
        self.path = path
        os.makedirs(path, exist_ok=True)

    def __enter__(self):
        return self.path

    def __exit__(self, *_exc):
        return False


def extract_audio(video_path, wav_path, sr=16000, ffmpeg="ffmpeg", nice=0):
    """音声を 16kHz mono の wav へ落とす。nice を渡すと優先度を下げる。"""
    cmd = [
        ffmpeg, "-y",
        "-loglevel", "error",
        "-threads", "1",
        "-analyzeduration", "100M",
        "-probesize", "100M",
        "-i", video_path,
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", str(sr),
        "-c:a", "pcm_s16le",
        wav_path
    ]
    kw = {}
    if nice and hasattr(os, 'nice'):
        kw['preexec_fn'] = lambda: os.nice(int(nice))
    subprocess.run(cmd, check=True, **kw)


# ============================
# MFCCライクな特徴量計算
# ============================
def _read_wav_mono(wav_path):
    """pcm_s16le / mono の wav を読んで (float配列[-1,1), サンプルレート) を返す。

    soundfile.read の置き換え。extract_audio が -ac 1 -ar 16000 -c:a pcm_s16le で
    書き出したものだけを読むので、この形式に限定する。
    """
    with wave.open(wav_path, 'rb') as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise RuntimeError('想定外のwav形式(16bit mono以外)')
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    # soundfile.read と同じく [-1, 1) の float64 に正規化する
    return np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0, sr


# ============================
# 音声ファイル → 特徴量
# ============================
def audio_to_features(wav_path, sr=16000, resolution_ms=500):
    """
    wavファイルから特徴量を計算する。
    resolution_ms: 時間分解能(ms) デフォルト500ms
    """
    y, file_sr = _read_wav_mono(wav_path)
    if file_sr != sr:
        raise RuntimeError("Sample rate mismatch")

    print(f"  Resolution: {resolution_ms}ms")
    feat, time_resolution = _compute_features(y, sr, resolution_ms)
    return feat, time_resolution, y  # yはrefine用に返す


# ============================
# 粗探索用ハッシュ
# ============================
def build_hash_index(feats, q=0.5):
    index = {}
    for i in range(feats.shape[1]):
        h = int(feats[0, i] / q)
        index.setdefault(h, []).append(i)
    return index


# ============================
# 相関係数による類似度計算
# ============================
def compute_correlation(feat_a, feat_b, i, j, window=5):
    """指定位置周辺の相関係数を計算"""
    start_i = max(0, i - window // 2)
    end_i = min(feat_a.shape[1], i + window // 2 + 1)
    start_j = max(0, j - window // 2)
    end_j = min(feat_b.shape[1], j + window // 2 + 1)

    if end_i - start_i != end_j - start_j:
        return 0.0

    vec_a = feat_a[:, start_i:end_i].flatten()
    vec_b = feat_b[:, start_j:end_j].flatten()

    mean_a = vec_a.mean()
    mean_b = vec_b.mean()

    numerator = np.sum((vec_a - mean_a) * (vec_b - mean_b))
    denominator = np.sqrt(np.sum((vec_a - mean_a)**2) * np.sum((vec_b - mean_b)**2))

    if denominator < 1e-8:
        return 0.0

    return numerator / denominator


# ============================
# 時刻フォーマット変換
# ============================
def format_time(seconds):
    """秒数をHH:MM:SS.mmmに変換"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def parse_time(time_str):
    """HH:MM:SS.mmmを秒数に変換"""
    parts = time_str.split(':')
    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds
