"""ロゴの出ている時間（ロゴのファイルを読む・トリム後の時間へ直す）"""

from typing import List, Tuple, Dict, Any
from read_tsprogram.streams import CLOCK_FREQ, PTS_CYCLE, VideoFrame
from .frames import TrimRange


def parse_logo_file(logo_file: str) -> List[Tuple[int, int]]:
    logo_ranges = []
    start_frame = None
    with open(logo_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            frame = int(parts[0])
            kind = parts[1].upper()
            if kind == 'S':
                start_frame = frame
            elif kind == 'E' and start_frame is not None:
                logo_ranges.append((start_frame, frame))
                start_frame = None
    return logo_ranges


def calculate_logo_times_after_cut(
    logo_ranges: List[Tuple[int, int]],
    trim_ranges: List[TrimRange],
    video_index: List[VideoFrame]
) -> List[Dict[str, Any]]:
    results = []
    total_frames = len(video_index)

    for logo_idx, (logo_start, logo_end) in enumerate(logo_ranges):
        for trim_idx, tr in enumerate(trim_ranges):
            overlap_start = max(logo_start, tr.start_frame)
            overlap_end = min(logo_end, tr.end_frame)
            if overlap_start > overlap_end:
                continue

            if overlap_start >= total_frames or overlap_end >= total_frames:
                continue

            logo_start_pts = video_index[overlap_start].pts
            logo_end_pts = video_index[overlap_end].pts

            cut_start_pts = (logo_start_pts + tr.offset_pts + PTS_CYCLE) % PTS_CYCLE
            cut_end_pts   = (logo_end_pts   + tr.offset_pts + PTS_CYCLE) % PTS_CYCLE

            trim_cut_start_pts = (tr.start_pts + tr.offset_pts + PTS_CYCLE) % PTS_CYCLE
            start_sec = (cut_start_pts - trim_cut_start_pts + PTS_CYCLE) % PTS_CYCLE / CLOCK_FREQ
            end_sec   = (cut_end_pts   - trim_cut_start_pts + PTS_CYCLE) % PTS_CYCLE / CLOCK_FREQ

            cumulative_offset_sec = 0.0
            for prev_tr in trim_ranges[:trim_idx]:
                prev_duration_pts = (prev_tr.end_pts - prev_tr.start_pts + PTS_CYCLE) % PTS_CYCLE
                cumulative_offset_sec += prev_duration_pts / CLOCK_FREQ

            abs_start_sec = cumulative_offset_sec + start_sec
            abs_end_sec   = cumulative_offset_sec + end_sec

            results.append({
                "logo_index": logo_idx + 1,
                "trim_index": trim_idx + 1,
                "logo_frames": [logo_start, logo_end],
                "overlap_frames": [overlap_start, overlap_end],
                "start_sec": round(abs_start_sec, 3),
                "end_sec": round(abs_end_sec, 3),
                "duration_sec": round(abs_end_sec - abs_start_sec, 3),
            })

    return results
