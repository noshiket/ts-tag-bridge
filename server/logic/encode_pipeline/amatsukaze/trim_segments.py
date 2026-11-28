"""Amatsukaze の作業フォルダからトリムの区間を読む"""

import glob as _glob
import os
from typing import Optional


def get_trim_segments(
    source_ts_app: str,
    amt_dir_app: str,
    video_pid: Optional[int] = None,
    input_ts_app: Optional[str] = None,
) -> list[dict]:
    """
    amt_dir 内の vfilter*-main.avs と amts0.dat を使い、
    エンコード後トリム各セグメントの TOT 時刻と再生時間を返す。

    input_ts_app: Amatsukaze に投入した TS の app パス。
        split 後の cut.ts など source_ts_app と異なる場合に指定する。
        amts0.dat 使用時は input_ts_app から TOT を取得する（PTS 空間が一致するため）。
    """
    from media.amatsukaze.amatsukaze_files.frames import parse_avs_file, parse_amtsource_dat
    from read_tsprogram.streams import StreamAnalyzer
    from read_tsprogram.tot import collect_all_tot_entries, interpolate_tot_for_pts

    avs_candidates = sorted(_glob.glob(os.path.join(amt_dir_app, 'vfilter*-main.avs')))
    if not avs_candidates:
        raise RuntimeError(f"vfilter*-main.avs が見つかりません: {amt_dir_app}")
    if len(avs_candidates) == 1:
        avs_file = avs_candidates[0]
    else:
        def _total_frames(path):
            try:
                return sum(e - s + 1 for s, e in parse_avs_file(path))
            except Exception:
                return -1
        avs_file = max(avs_candidates, key=_total_frames)

    dat_file = os.path.join(amt_dir_app, 'amts0.dat')
    trim_specs = parse_avs_file(avs_file)

    # amts0.dat がある場合は PTS もそこから取る
    # TOT 取得元も amts0.dat と同じ PTS 空間の TS を使う
    if os.path.exists(dat_file):
        pts_list = parse_amtsource_dat(dat_file)
        tot_ts = input_ts_app or source_ts_app
    else:
        tot_ts = source_ts_app
        if video_pid is None:
            video_pid = StreamAnalyzer().find_video_pid(tot_ts)
        video_index = StreamAnalyzer().build_video_index(tot_ts, video_pid)
        pts_list = [f.pts for f in video_index]

    if not pts_list:
        raise RuntimeError("フレーム PTS リストが空です")

    if video_pid is None:
        video_pid = StreamAnalyzer().find_video_pid(tot_ts)

    tot_entries = collect_all_tot_entries(tot_ts, video_pid)

    result = []
    for start_frame, end_frame in trim_specs:
        start_pts = pts_list[start_frame]
        end_pts   = pts_list[min(end_frame, len(pts_list) - 1)]
        start_dt  = interpolate_tot_for_pts(tot_entries, start_pts)
        end_dt    = interpolate_tot_for_pts(tot_entries, end_pts)
        duration  = round((end_pts - start_pts) / 90_000.0, 3)
        result.append({
            'start':        start_dt.isoformat() if start_dt else None,
            'end':          end_dt.isoformat()   if end_dt   else None,
            'duration_sec': duration,
            'start_frame':  start_frame,
            'end_frame':    end_frame,
            'start_pts':    start_pts,
            'end_pts':      end_pts,
        })
    return result
