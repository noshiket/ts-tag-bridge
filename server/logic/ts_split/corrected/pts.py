"""PCR / PTS / DTS の読み書きと補正の補助"""

import bisect
from typing import List, Optional
from read_tsprogram.pcr_scan import PCR_WRAP
from read_tsprogram.streams import PTS_CYCLE

# PES の PTS/DTS を書く時の marker_bit
MARKER_BIT = 0x01


# =============================================================================
# PCR / PTS / DTS 補正ヘルパー
# =============================================================================

def _shift_pcr_inplace(pkt: bytearray, delta: int) -> None:
    """PCR を持つパケットの PCR に delta（27MHz）を足して書き戻す。PCR_WRAP で折り返す。

    PCR を持つかの判定（adaptation_field の PCR_flag）は呼び出し側で済ませておく
    （パケットごとに回るループなので、持たないパケットでは関数を呼ばない）。
    """
    b = pkt[6:12]
    base = ((b[0] << 25) | (b[1] << 17) | (b[2] << 9) | (b[3] << 1) | (b[4] >> 7))
    ext = ((b[4] & 1) << 8) | b[5]
    new_pcr = (base * 300 + ext + delta + PCR_WRAP) % PCR_WRAP
    nb = new_pcr // 300
    ne = new_pcr % 300
    pkt[6]  = (nb >> 25) & 0xFF
    pkt[7]  = (nb >> 17) & 0xFF
    pkt[8]  = (nb >>  9) & 0xFF
    pkt[9]  = (nb >>  1) & 0xFF
    pkt[10] = ((nb & 1) << 7) | 0x7E | ((ne >> 8) & 1)
    pkt[11] = ne & 0xFF


def _read_ts_val(pkt: bytearray, pos: int) -> Optional[int]:
    """PES ヘッダの PTS/DTS 値（90kHz）を読む。"""
    if pos + 5 > len(pkt):
        return None
    return (((pkt[pos]   & 0x0E) << 29) |
            ((pkt[pos+1] & 0xFF) << 22) |
            ((pkt[pos+2] & 0xFE) << 14) |
            ((pkt[pos+3] & 0xFF) <<  7) |
            ((pkt[pos+4] & 0xFE) >>  1))


def _write_ts_val(pkt: bytearray, pos: int, val: int, marker_high: int) -> None:
    """PES ヘッダの PTS/DTS 値（90kHz）を書く。"""
    pkt[pos]   = marker_high | ((val >> 29) & 0x0E) | MARKER_BIT
    pkt[pos+1] = (val >> 22) & 0xFF
    pkt[pos+2] = ((val >> 14) & 0xFE) | MARKER_BIT
    pkt[pos+3] = (val >>  7) & 0xFF
    pkt[pos+4] = ((val <<  1) & 0xFE) | MARKER_BIT


def _extract_pes_pts(pkt: bytes) -> Optional[int]:
    """PUSI=1 パケットの PES ヘッダから PTS を返す。PES start code がなければ None。"""
    off = 4
    afc = (pkt[3] >> 4) & 0x3
    if afc in (0b10, 0b11):
        off += 1 + pkt[4]
    if off + 9 > len(pkt):
        return None
    if pkt[off] != 0x00 or pkt[off + 1] != 0x00 or pkt[off + 2] != 0x01:
        return None
    flag = (pkt[off + 7] >> 6) & 0x03
    if not (flag & 0x02):
        return None
    base = off + 9
    if base + 5 > len(pkt):
        return None
    return _read_ts_val(bytearray(pkt), base)


def _nearest_frame_idx(pts_vals: List[int], target_pts: int) -> int:
    """pts_vals（昇順ソート済み）から target_pts に最も近いインデックスを返す。"""
    idx = bisect.bisect_left(pts_vals, target_pts)
    if idx == 0:
        return 0
    if idx >= len(pts_vals):
        return len(pts_vals) - 1
    if abs(pts_vals[idx] - target_pts) <= abs(pts_vals[idx - 1] - target_pts):
        return idx
    return idx - 1


def _adjust_pts_dts_inplace(pkt: bytearray, pts_offset_90khz: int) -> None:
    """
    PUSI=1 のパケットの PES ヘッダ内 PTS/DTS を補正する。
    PES スタートコード (00 00 01) が確認できない場合は何もしない。
    """
    if not (pkt[1] & 0x40):   # PUSI チェック
        return
    off = 4
    afc = (pkt[3] >> 4) & 0x3
    if afc in (0b10, 0b11):
        off += 1 + pkt[4]
    if off + 9 > len(pkt):
        return
    if pkt[off] != 0x00 or pkt[off+1] != 0x00 or pkt[off+2] != 0x01:
        return   # PES スタートコードなし（PAT/PMT 等）
    flag = (pkt[off + 7] >> 6) & 0x03
    if flag == 0:
        return
    base = off + 9
    if flag & 0x02:   # PTS あり
        pts = _read_ts_val(pkt, base)
        if pts is not None:
            new_pts = (pts + pts_offset_90khz + PTS_CYCLE) % PTS_CYCLE
            _write_ts_val(pkt, base, new_pts, 0x30 if flag == 0x03 else 0x20)
    if flag == 0x03:  # DTS あり
        dts = _read_ts_val(pkt, base + 5)
        if dts is not None:
            new_dts = (dts + pts_offset_90khz + PTS_CYCLE) % PTS_CYCLE
            _write_ts_val(pkt, base + 5, new_dts, 0x10)
