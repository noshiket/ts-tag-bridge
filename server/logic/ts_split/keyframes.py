"""キーフレームの位置で、再スキャンせずにバイト範囲で分ける（split_by_keyframes）"""

import os
import bisect
from typing import List, Optional, Tuple
from read_tsprogram.constants import SYNC_BYTE, TS_PACKET_SIZE
from read_tsprogram.pcr_scan import PCR_BASE_HZ, PCR_WRAP, scan_ts_info
from read_tsprogram.streams import PTS_CYCLE
from .segment import Segment
from .corrected.pts import _adjust_pts_dts_inplace, _shift_pcr_inplace  # noqa: F401


# =============================================================================
# key_frames ベースの高速分割（再スキャンなし・byte 範囲コピー）
# =============================================================================

_KF_HEADROOM_TICKS = 90_000   # 1秒。音声先行が負値→ラップしないための余裕


def _copy_segment_raw(ts_path: str, out_path: str, start_offset: int, end_offset: int,
                      pat_pmt: bytes) -> None:
    """[start_offset, end_offset) を生のまま byte コピーする（PAT/PMT 先頭付与）。"""
    with open(ts_path, 'rb') as f, open(out_path, 'wb') as o:
        if pat_pmt:
            o.write(pat_pmt)
        f.seek(start_offset)
        remaining = end_offset - start_offset
        while remaining > 0:
            chunk = f.read(min(1 << 20, remaining))
            if not chunk:
                break
            o.write(chunk)
            remaining -= len(chunk)


def _copy_segment_rebased(ts_path: str, out_path: str, start_offset: int, end_offset: int,
                          start_dts: int, pat_pmt: bytes) -> None:
    """ラップを跨ぐ区間用: PCR/PTS/DTS を連続化リベースしながら byte 範囲をコピーする。

    anchor = start_dts - HEADROOM を 0 基準に引く（mod 演算でラップ跨ぎが自動的に
    連続化される）。HEADROOM 分の余裕で先行音声も負値にならない。CC は元の連続
    スライスなので書き換えない。
    """
    anchor_raw = (start_dts - _KF_HEADROOM_TICKS) % PTS_CYCLE
    pts_offset = (PTS_CYCLE - anchor_raw) % PTS_CYCLE
    anchor_pcr = (anchor_raw * 300) % PCR_WRAP
    WRITE_BUF = TS_PACKET_SIZE * 512

    buf = bytearray()
    carry = b''
    with open(ts_path, 'rb') as f, open(out_path, 'wb') as o:
        if pat_pmt:
            o.write(pat_pmt)
        f.seek(start_offset)
        remaining = end_offset - start_offset
        while remaining > 0:
            chunk = f.read(min(1 << 20, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            data = carry + chunk
            n = len(data) // TS_PACKET_SIZE
            for i in range(n):
                pkt = bytearray(data[i * TS_PACKET_SIZE:(i + 1) * TS_PACKET_SIZE])
                if pkt[0] == SYNC_BYTE:
                    # PCR 補正
                    afc = (pkt[3] >> 4) & 0x3
                    if afc in (0b10, 0b11) and pkt[4] >= 7 and (pkt[5] & 0x10):
                        _shift_pcr_inplace(pkt, -anchor_pcr)
                    # PTS/DTS 補正
                    _adjust_pts_dts_inplace(pkt, pts_offset)
                buf.extend(pkt)
            carry = data[n * TS_PACKET_SIZE:]
            if len(buf) >= WRITE_BUF:
                o.write(buf)
                buf.clear()
        if carry:
            buf.extend(carry)
        if buf:
            o.write(buf)


def split_by_keyframes(
    ts_path: str,
    segments: List[Segment],
    key_frames: List[dict],
    output_dir: str = '',
    verbose: bool = True,
    display_shift: Optional[int] = None,
) -> Tuple[bool, str, List[str]]:
    """recordings/encodings.key_frames を使い、TS を全走査せず byte 範囲コピーで分割する。

    key_frames: [{'offset': <byte位置>, 'dts': <90kHz 連続値>}, ...]（I フレーム＝キーフレーム）

    - TS の全走査（PTS インデックス構築）を行わず、各セグメント境界を直近キーフレームに
      スナップして byte 範囲を seek+コピーするだけ。
    - PTS/DTS/PCR/CC は書き換えない（生のまま）。先頭に PAT/PMT のみ付与する。
    - start は「dts <= 目標」の最後のキーフレーム（その GOP 先頭 I フレーム）、
      end は「dts >= 目標」の最初のキーフレーム（含まない＝直前 GOP まで）。末尾超過は EOF。

    key_frames が空/不正なら False を返す（呼び出し側で従来法へフォールバック）。
    """
    if not os.path.isfile(ts_path):
        return False, f"ファイルが見つかりません: {ts_path}", []
    if not segments:
        return False, "セグメントが指定されていません", []
    if not key_frames:
        return False, "key_frames が空です", []
    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(ts_path))

    # PAT/PMT は head スキャンのみで取得（先頭付与用）
    if verbose:
        print(f"[keyframe] PAT/PMT head スキャン: {ts_path}")
    info = scan_ts_info(ts_path)
    pat_pmt = b''.join(info.pat_packets) + b''.join(info.pmt_packets.values())

    # キーフレームを dts 昇順に整列
    kf = sorted(key_frames, key=lambda k: k['dts'])
    dts_list = [k['dts'] for k in kf]
    base_dts = dts_list[0]
    file_size = os.path.getsize(ts_path)

    out_paths: List[str] = []
    failed: List[str] = []

    # 表示/trim基準(first_pts)との原点差補正。display_shift =
    # frames[0](最初のGOP頭の表示PTS) - first_pts。key_frames[0]基準のtargetへ
    # 平行移動する。start側はDTSがPTSに先行する分のリオーダマージン(0.2秒)を
    # 追加で手前に取り、表示フレームの頭欠けを防ぐ(GOP頭スナップなので余分に含む側へ倒す)
    shift = display_shift if display_shift is not None else 0
    reorder_margin = 18000 if display_shift is not None else 0

    for seg in segments:
        target_s = base_dts + int(seg.start_time * PCR_BASE_HZ) - shift - reorder_margin
        target_e = base_dts + int(seg.end_time   * PCR_BASE_HZ) - shift

        si = bisect.bisect_right(dts_list, target_s) - 1
        if si < 0:
            si = 0
        start_offset = kf[si]['offset']

        ei = bisect.bisect_left(dts_list, target_e)
        end_offset = kf[ei]['offset'] if ei < len(kf) else file_size
        if end_offset <= start_offset:
            end_offset = file_size

        start_dts = kf[si]['dts']
        end_dts = kf[ei]['dts'] if ei < len(kf) else dts_list[-1]
        # 連続 dts が 2^33(PTS_CYCLE) の境界を跨ぐ＝生 PTS がこの区間内でラップする。
        crosses_wrap = (start_dts // PTS_CYCLE) != (end_dts // PTS_CYCLE)

        full_dir = os.path.join(output_dir, seg.output_folder) if seg.output_folder else output_dir
        os.makedirs(full_dir, exist_ok=True)
        out_path = os.path.join(full_dir, seg.output_filename)

        try:
            if crosses_wrap:
                # ラップ跨ぎ: PCR/PTS/DTS を連続化リベース（生のままだと duration が壊れる）
                _copy_segment_rebased(ts_path, out_path, start_offset, end_offset, start_dts, pat_pmt)
            else:
                # ラップ無し: 生のまま高速 byte コピー
                _copy_segment_raw(ts_path, out_path, start_offset, end_offset, pat_pmt)
            out_paths.append(out_path)
            if verbose:
                size_mb = os.path.getsize(out_path) / (1024 * 1024)
                print(f"      ✓ {out_path} ({size_mb:.1f} MB) "
                      f"[{seg.start_time:.1f}s-{seg.end_time:.1f}s → bytes {start_offset}-{end_offset}]"
                      f"{' (rebased: wrap跨ぎ)' if crosses_wrap else ''}")
        except Exception as e:
            failed.append(seg.output_filename)
            if verbose:
                print(f"      ✗ {out_path}: {e}")

    if out_paths:
        msg = f"{len(out_paths)}件分割完了(keyframe)"
        if failed:
            msg += f"、{len(failed)}件失敗: {', '.join(failed)}"
        return True, msg, out_paths
    return False, "全セグメントの分割に失敗しました(keyframe)", []
