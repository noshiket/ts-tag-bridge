"""補正付きの分割: 区間ごとの切る位置を決める（映像のフレームに合わせる・PCR/PTS の補正量）"""

from typing import List, Tuple
from read_tsprogram.pcr_scan import PCR_WRAP, sec_to_pcr
from read_tsprogram.streams import PTS_CYCLE
from ..segment import Segment
from .pts import _nearest_frame_idx
from .pts_index import _build_video_pts_index, _get_initial_pts_min


def plan_segments(ts_path: str, info, segments: List[Segment], verbose: bool) -> Tuple[list, bool]:
    """区間ごとの位置（start/end の tick とバイト位置・補正量）と、バイト位置で選べるか。

    映像のフレームの並びが取れれば、区間の端を一番近いフレームに合わせてバイト位置で選ぶ。
    取れなければ PCR の tick で選ぶ。
    """
    # --- Phase 1.5: ビデオ PTS インデックス構築（フレーム精度カット用）---
    _video_pid = info.video_pid or info.pcr_pid
    pts_index = _build_video_pts_index(ts_path, _video_pid) if _video_pid is not None else []
    if pts_index:
        # B フレームにより PTS はファイル順（DTS順）と異なるため、
        # PTS 順にソートして bisect が正しく動作するようにする
        pts_index.sort(key=lambda x: x[0])
        initial_pts = pts_index[0][0]
        pts_vals    = [p[0] for p in pts_index]
        # format.start_time 相当（split.jsx / ffprobe と同じ基準）
        pts_timeline_base = _get_initial_pts_min(ts_path, ref_pts=initial_pts) or initial_pts
    else:
        initial_pts = None
        pts_vals    = []
        pts_timeline_base = None
    if verbose:
        pid_str = f"0x{_video_pid:04X}" if _video_pid is not None else "不明"
        print(f"      ビデオ PID: {pid_str}, フレーム数: {len(pts_index)}")

    # --- Phase 2: セグメントごとのオフセット計算 ---
    # PCR offset (27MHz): 各セグメント先頭の予測 PCR を 0 に引き戻す値
    # PTS offset (90kHz): 同等の 90kHz 補正値 (PCR_base ≈ PTS の関係)
    initial_pts_approx = info.initial_pcr // 300
    pts_base = initial_pts if pts_index else initial_pts_approx

    seg_infos = []
    for seg in segments:
        if pts_index:
            # フレーム精度スナップ: pts_timeline_base は split.jsx/ffprobe と同じ基準
            target_s = pts_timeline_base + int(seg.start_time * 90_000)
            target_e = pts_timeline_base + int(seg.end_time   * 90_000)
            si_idx = _nearest_frame_idx(pts_vals, target_s)
            ei_idx = _nearest_frame_idx(pts_vals, target_e)
            actual_start_sec = (pts_vals[si_idx] - initial_pts) / 90_000.0
            actual_end_sec   = (pts_vals[ei_idx] - initial_pts) / 90_000.0
            start_offset = pts_index[si_idx][1]
            end_offset   = pts_index[ei_idx][1]
        else:
            actual_start_sec = seg.start_time
            actual_end_sec   = seg.end_time
            start_offset = None
            end_offset   = None

        start_27mhz = sec_to_pcr(actual_start_sec)
        end_27mhz   = sec_to_pcr(actual_end_sec)
        # PCR 補正量: -(initial_pcr + start_27mhz) mod PCR_WRAP
        pcr_offset = (-(info.initial_pcr + start_27mhz) + PCR_WRAP) % PCR_WRAP
        # PTS 補正量: -(initial_pts_approx + start_90kHz) mod PTS_CYCLE
        pts_offset = (-(pts_base + int(actual_start_sec * 90_000)) + PTS_CYCLE) % PTS_CYCLE
        seg_infos.append({
            'start_ticks':  start_27mhz,
            'end_ticks':    end_27mhz,
            'start_offset': start_offset,
            'end_offset':   end_offset,
            'pcr_offset':   pcr_offset,
            'pts_offset':   pts_offset,
        })
        if verbose:
            snap_info = f" (snapped from {seg.start_time:.3f}s)" if pts_index else ""
            print(f"      '{seg.output_filename}': "
                  f"{actual_start_sec:.3f}s - {actual_end_sec:.3f}s{snap_info}")

    return seg_infos, bool(pts_index)
