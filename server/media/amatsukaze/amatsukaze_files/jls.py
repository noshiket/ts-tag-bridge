"""チャプター・JLS・ロゴの読み取りと、トリムの区間"""

from typing import List, Optional, Tuple
from read_tsprogram.streams import CLOCK_FREQ, PTS_CYCLE, VideoFrame
from .frames import FrameRangeError, StreamNotFoundError, TrimRange


# ==============================================================================
# JLS / Chapter Parsers & Segment Logic
# ==============================================================================

def parse_chapter_file(chapter_file: str) -> List[Tuple[str, float]]:
    chapters = []
    with open(chapter_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or '=' not in line:
                continue
            if line.startswith('CHAPTER') and 'NAME' not in line:
                parts = line.split('=')
                if len(parts) == 2:
                    time_str = parts[1]
                    time_parts = time_str.split(':')
                    if len(time_parts) == 3:
                        hours = int(time_parts[0])
                        minutes = int(time_parts[1])
                        seconds = float(time_parts[2])
                        total_seconds = hours * 3600 + minutes * 60 + seconds
                        chapters.append((parts[0], total_seconds))
    return chapters

def parse_jls_file(jls_file: str) -> List[Tuple[int, int, int, str]]:
    segments = []
    with open(jls_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            if len(parts) >= 3:
                start_frame = int(parts[0])
                end_frame = int(parts[1])
                duration_sec = int(parts[2])
                label = ''
                if len(parts) > 5 and ':' in parts[5]:
                    label = parts[5].split(':')[1]
                segments.append((start_frame, end_frame, duration_sec, label))
    return segments

def filter_jls_segments_by_trim(
    trim_specs: List[Tuple[int, int]],
    jls_segments: List[Tuple[int, int, int, str]]
) -> List[Tuple[int, int, int, str]]:
    sorted_trims = sorted(trim_specs)
    filtered = []
    for seg_start, seg_end, duration, label in jls_segments:
        for trim_start, trim_end in sorted_trims:
            if seg_end < trim_start: break
            if seg_start >= trim_start and seg_end <= trim_end:
                filtered.append((seg_start, seg_end, duration, label))
                break
            if seg_start > trim_end: continue
    return filtered

def find_trim_chapter_mapping(
    trim_specs: List[tuple],
    filtered_jls_segments: List[Tuple[int, int, int, str]],
    chapter_times: List[float]
) -> List[Tuple[int, int]]:
    mappings = []
    sorted_segments = sorted(filtered_jls_segments, key=lambda x: x[0])
    chapter_offset = 0

    for trim_start, trim_end in trim_specs:
        segments_in_trim = []
        for seg_start, seg_end, duration, label in sorted_segments:
            if seg_start >= trim_start and seg_end <= trim_end:
                segments_in_trim.append((seg_start, seg_end))

        if not segments_in_trim:
            mappings.append((chapter_offset, chapter_offset + 1))
            chapter_offset += 1
            continue

        start_chapter = chapter_offset
        end_chapter = start_chapter + len(segments_in_trim)
        mappings.append((start_chapter, end_chapter))
        chapter_offset = end_chapter

    return mappings

def calculate_trim_ranges_with_jls(
    trim_specs: List[tuple],
    video_index: List[VideoFrame],
    jls_segments: Optional[List[Tuple[int, int, int, str]]] = None,
    chapter_times: Optional[List[float]] = None
) -> List[TrimRange]:
    if not video_index:
        raise StreamNotFoundError("No video frames found in input file")

    total_frames = len(video_index)
    result = []
    cumulative_pts = 0

    chapter_mappings = None
    if jls_segments and chapter_times:
        chapter_mappings = find_trim_chapter_mapping(trim_specs, jls_segments, chapter_times)
        print("Trim to Chapter mapping:")
        for i, ((trim_start, trim_end), (ch_start, ch_end)) in enumerate(zip(trim_specs, chapter_mappings)):
            if ch_start < len(chapter_times) and ch_end < len(chapter_times):
                duration = chapter_times[ch_end] - chapter_times[ch_start]
                print(f"  Trim[{i+1}] frames [{trim_start},{trim_end}] → Chapter{ch_start+1} to Chapter{ch_end+1} = {duration:.3f}s")
        print()

    for i, (start_frame, end_frame) in enumerate(trim_specs):
        if start_frame < 0:
            raise FrameRangeError(f"Frame {start_frame} is out of range (must be >= 0)")
        if start_frame >= total_frames:
            raise FrameRangeError(f"Frame {start_frame} is out of range (total frames: {total_frames})")
        if start_frame > end_frame:
            raise FrameRangeError(f"Invalid range [{start_frame},{end_frame}]: start must be <= end")

        start_pts = video_index[start_frame].pts

        if chapter_mappings and i < len(chapter_mappings):
            ch_start, ch_end = chapter_mappings[i]
            if ch_end < len(chapter_times):
                duration = chapter_times[ch_end] - chapter_times[ch_start]
                end_pts = int(start_pts + duration * CLOCK_FREQ)
            else:
                end_pts = start_pts + round((end_frame - start_frame) / 29.97 * CLOCK_FREQ)
        else:
            end_pts = start_pts + round((end_frame - start_frame) / 29.97 * CLOCK_FREQ)

        end_pts = end_pts % PTS_CYCLE

        if i == 0:
            offset_pts = 0
        else:
            offset_pts = cumulative_pts - start_pts

        result.append(TrimRange(
            start_frame=start_frame,
            end_frame=end_frame,
            start_pts=start_pts,
            end_pts=end_pts,
            offset_pts=offset_pts
        ))

        cumulative_pts = (end_pts + offset_pts + PTS_CYCLE) % PTS_CYCLE

    return result
