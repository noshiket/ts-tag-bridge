# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

from __future__ import annotations

from typing import TypedDict


class KeyFrame(TypedDict):
    """映像キーフレーム（ランダムアクセス可能点）の位置情報。"""
    offset: int  # 入力ファイル上のバイト位置
    dts: int     # 入力ソース側の DTS (90kHz)


class SegmentMapEntry(TypedDict):
    """HLS シーケンス番号ごとの、入力ファイル開始位置キャッシュ。"""
    sequence_index: int
    source_file_position: int
    source_start_dts: int
