"""H.265 の絵の種類（NAL・SPS からインターレースか）"""

from typing import Optional
from .codec import _PIC_FRAME


# IRAP(ランダムアクセス可能点)の nal_unit_type。BLA_W_LP(16)〜CRA_NUT(21)
_H265_IRAP = frozenset(range(16, 22))


_H265_NAL_SPS = 33


def _rbsp(data: bytes) -> bytes:
    """エミュレーション防止バイト(00 00 03)の 03 を取り除く。"""
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        if i + 2 < n and data[i] == 0 and data[i + 1] == 0 and data[i + 2] == 3:
            out += data[i:i + 2]
            i += 3
        else:
            out.append(data[i])
            i += 1
    return bytes(out)


def _iter_nal_h265(head: bytes):
    """(nal_unit_type, ペイロード開始位置) を順に返す。開始コードは 00 00 01。"""
    i = 0
    n = len(head)
    while True:
        i = head.find(b'\x00\x00\x01', i)
        if i < 0 or i + 5 > n:
            return
        p = i + 3
        yield (head[p] >> 1) & 0x3F, p + 2
        i = p


def _h265_sps_interlaced(payload: bytes) -> Optional[int]:
    """SPS の general_interlaced_source_flag を返す。読めなければ None。

    profile_tier_level の並び(ITU-T H.265 7.3.3):
      sps_video_parameter_set_id(4) + sps_max_sub_layers_minus1(3)
        + sps_temporal_id_nesting_flag(1)              → 1バイト
      general_profile_space(2)+general_tier_flag(1)+general_profile_idc(5) → 1バイト
      general_profile_compatibility_flag[32]           → 4バイト
      general_progressive_source_flag(1)               → 次のバイトのビット7
      general_interlaced_source_flag(1)                → 同 ビット6
    """
    b = _rbsp(payload[:24])
    if len(b) < 7:
        return None
    return (b[6] >> 6) & 1


def _classify_picture_h265(head: bytes):
    """(pic, is_irap, sps_interlaced) を返す。sps_interlaced は SPS が無ければ None。

    原典 HEVCVideoParser.cpp:275-288。picture_structure が FRAME/UNKNOWN なら
    PIC_FRAME で、放送(BS4K)や本機のエンコード出力はこれに当たる。
    """
    is_irap = False
    interlaced = None
    for nal_type, payload_pos in _iter_nal_h265(head):
        if nal_type in _H265_IRAP:
            is_irap = True
        elif nal_type == _H265_NAL_SPS:
            v = _h265_sps_interlaced(head[payload_pos:])
            if v is not None:
                interlaced = v
    return _PIC_FRAME, is_irap, interlaced
