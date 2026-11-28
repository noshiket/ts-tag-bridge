"""Amatsukaze の出力の読み取り: amts0.dat のフレーム PTS と、avs の Trim"""

from collections import namedtuple
from typing import List, Tuple
import re

TrimRange = namedtuple('TrimRange', ['start_frame', 'end_frame', 'start_pts', 'end_pts', 'offset_pts'])

# amts0.dat / FilterSourceFrame
_VIDEOFORMAT_SIZE = 44
_AUDIOFORMAT_SIZE = 8
# FilterSourceFrameのサイズはAmatsukazeバージョンにより異なる:
#   旧版: 48バイト (halfDelay+pad+frameIndex+pts+frameDuration+framePTS+fileOffset+keyFrame+cmType)
#   新版: 56バイト (上記 + rigaya追加8バイト)
# parse_amtsource_dat内でPTS連続性チェックにより自動判別する
_PTS_DOUBLE_OFFSET = 8   # double pts within FilterSourceFrame (常に単調増加)
_FRAMEPTS_OFFSET   = 24  # int64_t framePTS (インターレース時にペアで同値になる場合あり)


# ==============================================================================
# Custom Exceptions
# ==============================================================================

class TSCutterError(Exception):
    pass

class StreamNotFoundError(TSCutterError):
    pass

class FrameRangeError(TSCutterError):
    pass

class ParseError(TSCutterError):
    pass


# ==============================================================================
# amts0.dat parser
# ==============================================================================

def parse_amtsource_dat(dat_file: str) -> List[int]:
    """
    amts0.datからFilterSourceFrameのframePTS（90kHz）リストを読む。
    FilterSourceFrameのサイズをPTS連続性チェックで自動判別する。

    amts0.datのバイナリ構造 (SaveAMTSource / StreamUtils.hpp):
      writeArray(srcpath)     : int64(len) + bytes
      writeArray(audiopath)   : int64(len) + bytes
      writeValue(VideoFormat) : 44 bytes
      writeValue(AudioFormat) : 8 bytes
      writeArray(FilterSourceFrame[]) : int64(count) + count * FRAME_SIZE bytes
        FilterSourceFrame:
          bool halfDelay(1) + pad(3) + int frameIndex(4)  @ offset 0
          double pts(8)                                    @ offset 8
          double frameDuration(8)                          @ offset 16
          int64_t framePTS(8)                              @ offset 24  ← 使用
          int64_t fileOffset(8)                            @ offset 32
          int keyFrame(4) + int cmType(4)                  @ offset 40
          (rigaya追加 8bytes: 新版のみ)                     @ offset 48
    """
    import struct

    with open(dat_file, 'rb') as f:
        data = f.read()

    pos = 0

    def read_array_str(p):
        length = struct.unpack_from('<q', data, p)[0]
        p += 8
        s = data[p:p + length].decode('utf-8', errors='replace')
        p += length
        return s, p

    _, pos = read_array_str(pos)   # srcpath
    _, pos = read_array_str(pos)   # audiopath

    pos += _VIDEOFORMAT_SIZE
    pos += _AUDIOFORMAT_SIZE

    frame_count = struct.unpack_from('<q', data, pos)[0]
    pos += 8
    frame_array_start = pos

    if frame_count <= 0 or frame_count > 10_000_000:
        raise ParseError(
            f"amts0.dat: frame_count={frame_count} が不正です。"
            f"対応していないAmatsukaze版のフォーマットの可能性があります。"
        )

    # double pts (offset 8) の連続性チェックでFRAME_SIZEを自動判別 (40〜256バイトを4刻みでスキャン)
    # int64 framePTS (offset 24) はインターレース時にフィールドペアで同値になるため使用しない
    _CHECK_FRAMES = 10
    frame_size = None
    for candidate in range(40, 257, 4):
        if frame_array_start + frame_count * candidate > len(data):
            continue
        check_count = min(_CHECK_FRAMES, frame_count - 1)
        if check_count < 1:
            continue
        pts_vals = [
            struct.unpack_from('<d', data, frame_array_start + i * candidate + _PTS_DOUBLE_OFFSET)[0]
            for i in range(check_count + 1)
        ]
        diffs = [pts_vals[i + 1] - pts_vals[i] for i in range(check_count)]
        if all(500 <= d <= 20000 for d in diffs):
            frame_size = candidate
            break

    if frame_size is None:
        # フレーム数が1の場合はファイルに収まる最小サイズで試みる
        if frame_count == 1:
            for candidate in range(40, 257, 4):
                if frame_array_start + candidate <= len(data):
                    frame_size = candidate
                    break
        if frame_size is None:
            pts0 = struct.unpack_from('<q', data, frame_array_start + _FRAMEPTS_OFFSET)[0] if frame_array_start + 8 <= len(data) else 'N/A'
            raise ParseError(
                f"amts0.dat: 有効なFRAME_SIZEが見つかりません (40〜256バイト, 4刻みでスキャン済み) "
                f"(frame_count={frame_count}, pts[0]={pts0})。"
                f"対応していないAmatsukaze版のフォーマットの可能性があります。"
            )

    print(f"[parse_amtsource_dat] FRAME_SIZE={frame_size} を使用: {dat_file}")

    pts_list = []
    for i in range(frame_count):
        frame_pts = struct.unpack_from('<q', data, frame_array_start + i * frame_size + _FRAMEPTS_OFFSET)[0]
        pts_list.append(frame_pts)

    return pts_list


# ==============================================================================
# AVS parser
# ==============================================================================

def parse_avs_file(avs_file: str) -> List[Tuple[int, int]]:
    """AVS / vfilter.avs から Trim(start,end) を抽出"""
    with open(avs_file, 'r', encoding='utf-8') as f:
        content = f.read()
    matches = re.findall(r'Trim\((\d+),(\d+)\)', content)
    if not matches:
        raise ParseError(f"No Trim() found in {avs_file}")
    return [(int(s), int(e)) for s, e in matches]
