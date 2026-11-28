"""音声のフレーム（Amatsukaze の FilterAudioFrame に当たるもの）"""

from typing import List
from .codec import (  # noqa: F401
    _CLOCK,
)
from .cache import (  # noqa: F401
    AAC_UNIT_SAMPLES,
)


def aac_unit_ticks(rate: int = 48000) -> float:
    """AACアクセスユニット1個ぶんの90kHzティック数。

    48000Hz なら 1920 ちょうどだが、44100Hz だと 2089.79… で**整数にならない**。
    配信の取り込みには 44100Hz のものがある（実測: 配信の取り込み）ので、
    割り切れる前提を置けない。
    """
    return AAC_UNIT_SAMPLES * _CLOCK / float(rate or 48000)


def audio_unit_pts(audio_pts: List[int], rate: int = 48000) -> List[int]:
    """音声PESのPTS列から、AACアクセスユニット1個ずつのPTS列を作る。

    **1つのPESにユニットが1〜2個入り、PTSは先頭にしか付かない。**
    何個入っているかは次のPESとのPTS差で分かる(48kHzなら1920で1個、3840で2個)。

    これを表として持たないと ffmpeg のパケット分割からは復元できない。
    ffmpeg は多ユニットPESを分けて渡すが、録画の先頭では余分なパケットを
    1つ出すことがあり、「重複なのか連続する2ユニットなのか」を受け側で
    決められない（実測: golden も二カ国語録画も先頭に余分が1つ出た）。

    44100Hz ではユニット長が整数にならないため、割り切れるかではなく
    四捨五入して誤差が小さいかで見る。48000Hz では従来と同じ結果になる。
    """
    ticks = aac_unit_ticks(rate)
    # 端数の許容。48kHz(1920)は誤差0なので影響しない
    tol = max(2.0, ticks * 0.01)
    out: List[int] = []
    for i, p in enumerate(audio_pts):
        n = 1
        if i + 1 < len(audio_pts):
            d = audio_pts[i + 1] - p
            # ドロップで大きく飛ぶことがあるので上限を置く。飛んだ分はゼロ埋めになる
            if d > 0:
                k = int(d / ticks + 0.5)
                if 1 <= k <= 8 and abs(d - k * ticks) <= tol:
                    n = k
        out.extend(p + int(k * ticks + 0.5) for k in range(n))
    return out


def audio_anchor(frames: List[int], half: List[bool], fps_num: int, fps_den: int) -> float:
    """音声スロット0に当たる時刻(90kHz)。

    原典 StreamReform.cpp:738-740。**先頭が BFF(halfDelay) なら 1/2 フレーム手前**に
    なる。amts0.dat の FilterSourceFrame[0].pts がこれで、framePTS とは別物。
    実測で二カ国語録画が halfDelay=1 で 1501.5 ティックずれており、
    これを見ないと音声が 1 ユニット(1024サンプル)ずれる。
    """
    if not frames:
        return 0.0
    t = fps_den * _CLOCK / float(fps_num)       # 1フレームのティック数
    return frames[0] - (t / 2 if (half and half[0]) else 0.0)
