"""音の特徴量（STFT・DCT・MFCC）"""

import numpy as np


# ============================
# 分解能 ↔ overlap 変換
# ============================
def resolution_to_overlap(resolution_ms, win_sec=1.0):
    """分解能(ms) → overlap率に変換"""
    return 1.0 - (resolution_ms / 1000.0) / win_sec


def overlap_to_resolution(overlap, win_sec=1.0):
    """overlap率 → 分解能(ms)に変換"""
    return win_sec * (1.0 - overlap) * 1000.0


def _stft_mag(y, nperseg, noverlap):
    """|STFT| を返す。scipy.signal.stft(boundary=None, padded=False) 相当。

    scipy は窓に periodic hann を使い(np.hanning は symmetric なので別物)、
    scaling='spectrum' の既定で 1/win.sum() を掛ける。MFCC は log1p を通すため
    このスケールが結果に効くので、両方を再現する。
    """
    hop = nperseg - noverlap
    n_frames = 1 + (len(y) - nperseg) // hop if len(y) >= nperseg else 0
    if n_frames <= 0:
        return np.zeros((nperseg // 2 + 1, 0))
    win = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(nperseg) / nperseg)  # periodic hann
    idx = np.arange(nperseg)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = y[idx] * win[None, :]
    return np.abs(np.fft.rfft(frames, axis=1).T / win.sum())


_DCT_CACHE = {}


def _dct2_ortho(x, n_out):
    """DCT-II(norm='ortho') を先頭 n_out 行だけ返す。scipy.fft.dct(axis=0) 相当。

    n_out=13 と小さいので、変換行列を作って matmul する(結果は厳密に一致する)。
    """
    n = x.shape[0]
    key = (n, n_out)
    m = _DCT_CACHE.get(key)
    if m is None:
        k = np.arange(n_out)[:, None]
        i = np.arange(n)[None, :]
        m = 2.0 * np.cos(np.pi * k * (2 * i + 1) / (2 * n))
        # ortho 正規化: k=0 は sqrt(1/(4N))、それ以外は sqrt(1/(2N))
        scale = np.full((n_out, 1), np.sqrt(1.0 / (2 * n)))
        if n_out > 0:
            scale[0, 0] = np.sqrt(1.0 / (4 * n))
        m = m * scale
        _DCT_CACHE[key] = m
    return m @ x


def compute_mfcc(mag_spec, n_mfcc=13):
    """簡易MFCC計算"""
    log_spec = np.log1p(mag_spec + 1e-8)
    mfcc = _dct2_ortho(log_spec, n_mfcc)
    return mfcc


# ============================
# 特徴量計算（共通処理）
# ============================
def _compute_features(y, sr, resolution_ms, win_sec=1.0):
    """
    ndarrayから特徴量を計算する共通処理。
    resolution_ms: 時間分解能(ms) → 内部でoverlapに変換
    """
    overlap = resolution_to_overlap(resolution_ms, win_sec)
    nperseg = int(sr * win_sec)
    noverlap = int(nperseg * overlap)
    hop_length = nperseg - noverlap
    time_resolution = hop_length / sr

    if len(y) < nperseg:
        y = np.pad(y, (0, nperseg - len(y)))

    mag = _stft_mag(y, nperseg, noverlap)
    mfcc = compute_mfcc(mag, n_mfcc=13)

    freqs = np.arange(mag.shape[0])
    spectral_centroid = np.sum(freqs[:, np.newaxis] * mag, axis=0) / (np.sum(mag, axis=0) + 1e-8)

    cumsum = np.cumsum(mag, axis=0)
    threshold = 0.85 * cumsum[-1, :]
    spectral_rolloff = np.argmax(cumsum >= threshold[np.newaxis, :], axis=0)

    high_freq_ratio = np.sum(mag[mag.shape[0]//2:, :], axis=0) / (np.sum(mag, axis=0) + 1e-8)

    feat = np.vstack([
        mfcc,
        spectral_centroid[np.newaxis, :],
        spectral_rolloff[np.newaxis, :],
        high_freq_ratio[np.newaxis, :]
    ])
    feat = (feat - feat.mean(axis=1, keepdims=True)) / (feat.std(axis=1, keepdims=True) + 1e-8)

    return feat, time_resolution
