# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

import math
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, PositiveInt


# サードパーティーライブラリのあるディレクトリ
THIRDPARTY_DIR = Path(__file__).resolve().parent.parent.parent / 'thirdparty'

# バイナリ拡張子
LIBRARY_EXTENSION = ('.exe' if sys.platform == 'win32' else '')

# サードパーティーライブラリのパス
LIBRARY_PATH: dict[str, str] = {
    'FFmpeg': str(THIRDPARTY_DIR / 'FFmpeg' / 'ffmpeg') + LIBRARY_EXTENSION,
    'FFprobe': str(THIRDPARTY_DIR / 'FFmpeg' / 'ffprobe') + LIBRARY_EXTENSION,
    'QSVEncC': str(THIRDPARTY_DIR / 'QSVEncC' / 'QSVEncC') + LIBRARY_EXTENSION,
    'NVEncC': str(THIRDPARTY_DIR / 'NVEncC' / 'NVEncC') + LIBRARY_EXTENSION,
    'VCEEncC': str(THIRDPARTY_DIR / 'VCEEncC' / 'VCEEncC') + LIBRARY_EXTENSION,
    'rkmppenc': str(THIRDPARTY_DIR / 'rkmppenc' / 'rkmppenc') + LIBRARY_EXTENSION,
    'tsreadex': str(THIRDPARTY_DIR / 'tsreadex' / 'tsreadex') + LIBRARY_EXTENSION,
    'psisiarc': str(THIRDPARTY_DIR / 'psisiarc' / 'psisiarc') + LIBRARY_EXTENSION,
    'psisimux': str(THIRDPARTY_DIR / 'psisimux' / 'psisimux') + LIBRARY_EXTENSION,
}


class Quality(BaseModel):
    is_hevc: bool
    is_60fps: bool
    width: PositiveInt
    height: PositiveInt
    video_bitrate: str
    video_bitrate_max: str
    audio_bitrate: str


# 音声のみ（映像を送らない）。QUALITY には入れず、セッションの audio_only で扱う
## セグメントの組み立ては映像の画質を1つ要るので AUDIO_ONLY_BASE_QUALITY を借りる（映像は出さない）
AUDIO_ONLY_QUALITY = 'audio'
AUDIO_ONLY_BASE_QUALITY = '360p'
AUDIO_ONLY_BITRATE = '192K'


QUALITY_TYPES = Literal[
    '1080p-60fps',
    '1080p-60fps-hevc',
    '1080p',
    '1080p-hevc',
    '810p',
    '810p-hevc',
    '720p',
    '720p-hevc',
    '540p',
    '540p-hevc',
    '480p',
    '480p-hevc',
    '360p',
    '360p-hevc',
    '240p',
    '240p-hevc',
]

QUALITY: dict[QUALITY_TYPES, Quality] = {
    '1080p-60fps': Quality(
        is_hevc=False, is_60fps=True,
        width=1440, height=1080,
        video_bitrate='9500K', video_bitrate_max='13000K', audio_bitrate='256K',
    ),
    '1080p-60fps-hevc': Quality(
        is_hevc=True, is_60fps=True,
        width=1440, height=1080,
        video_bitrate='3500K', video_bitrate_max='5200K', audio_bitrate='192K',
    ),
    '1080p': Quality(
        is_hevc=False, is_60fps=False,
        width=1440, height=1080,
        video_bitrate='9500K', video_bitrate_max='13000K', audio_bitrate='256K',
    ),
    '1080p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=1440, height=1080,
        video_bitrate='3000K', video_bitrate_max='4500K', audio_bitrate='192K',
    ),
    '810p': Quality(
        is_hevc=False, is_60fps=False,
        width=1440, height=810,
        video_bitrate='5500K', video_bitrate_max='7600K', audio_bitrate='192K',
    ),
    '810p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=1440, height=810,
        video_bitrate='2500K', video_bitrate_max='3700K', audio_bitrate='192K',
    ),
    '720p': Quality(
        is_hevc=False, is_60fps=False,
        width=1280, height=720,
        video_bitrate='4500K', video_bitrate_max='6200K', audio_bitrate='192K',
    ),
    '720p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=1280, height=720,
        video_bitrate='2000K', video_bitrate_max='3000K', audio_bitrate='192K',
    ),
    '540p': Quality(
        is_hevc=False, is_60fps=False,
        width=960, height=540,
        video_bitrate='3000K', video_bitrate_max='4100K', audio_bitrate='192K',
    ),
    '540p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=960, height=540,
        video_bitrate='1400K', video_bitrate_max='2100K', audio_bitrate='192K',
    ),
    '480p': Quality(
        is_hevc=False, is_60fps=False,
        width=854, height=480,
        video_bitrate='2000K', video_bitrate_max='2800K', audio_bitrate='192K',
    ),
    '480p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=854, height=480,
        video_bitrate='1050K', video_bitrate_max='1750K', audio_bitrate='192K',
    ),
    '360p': Quality(
        is_hevc=False, is_60fps=False,
        width=640, height=360,
        video_bitrate='1100K', video_bitrate_max='1800K', audio_bitrate='128K',
    ),
    '360p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=640, height=360,
        video_bitrate='750K', video_bitrate_max='1250K', audio_bitrate='128K',
    ),
    '240p': Quality(
        is_hevc=False, is_60fps=False,
        width=426, height=240,
        video_bitrate='550K', video_bitrate_max='650K', audio_bitrate='128K',
    ),
    '240p-hevc': Quality(
        is_hevc=True, is_60fps=False,
        width=426, height=240,
        video_bitrate='450K', video_bitrate_max='650K', audio_bitrate='128K',
    ),
}


def override_library_paths(config: dict) -> None:
    """config.yml の streaming セクション、またはトップレベルの ffmpeg/ffprobe パスで LIBRARY_PATH を上書きする。
    streaming.ffmpeg/ffprobe が指定されていればそちらを優先する。"""
    streaming = config.get('streaming') or {}
    if streaming.get('ffmpeg'):
        LIBRARY_PATH['FFmpeg'] = streaming['ffmpeg']
    elif config.get('ffmpeg'):
        LIBRARY_PATH['FFmpeg'] = config['ffmpeg']
    if streaming.get('ffprobe'):
        LIBRARY_PATH['FFprobe'] = streaming['ffprobe']
    elif config.get('ffprobe'):
        LIBRARY_PATH['FFprobe'] = config['ffprobe']


def display_aspect(width: int, height: int, sar: str | None) -> float | None:
    """表示の縦横比（幅 × 画素の縦横比 ÷ 高さ）。画素の縦横比が分からない時は None"""
    try:
        n, d = (int(x) for x in str(sar).split(':'))
    except (TypeError, ValueError):
        return None
    if n <= 0 or d <= 0 or width <= 0 or height <= 0:
        return None
    return width * n / d / height


def output_size(quality: QUALITY_TYPES, src_width: int, src_height: int,
                aspect: float | None = None) -> tuple[int, int, str]:
    """出力の幅・高さと表示の縦横比（DAR）。

    16:9 は品質の表のまま（1080p で入力がフル HD の時だけ 1920×1080）。
    それ以外は表のままだと歪むので、元の表示の縦横比（aspect）を保つ:
      縦長（スマホで撮った 1080×1920 など）は短い辺（幅）を品質の高さに（720p なら 720×1280）、
      4:3 などは高さを品質の高さに（720p なら 960×720）。
    aspect が分からない時（画素の縦横比を取っていない録画）は、縦長だけを幅と高さで見分ける。
    """
    q = QUALITY[quality]
    if aspect is None and src_width > 0 and src_height > src_width:
        aspect = src_width / src_height
    if aspect and abs(aspect - 16 / 9) > 0.02:
        if aspect < 1:
            width = q.height
            height = int(round(width / aspect / 2)) * 2
        else:
            height = q.height
            width = int(round(height * aspect / 2)) * 2
        g = math.gcd(width, height)
        return width, height, f'{width // g}:{height // g}'
    width = q.width
    if (q.width, q.height) == (1440, 1080) and (src_width, src_height) == (1920, 1080):
        width = 1920
    return width, q.height, '16:9'
