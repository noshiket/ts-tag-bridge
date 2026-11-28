"""一致の間のすき間（同じ長さのすき間をまとめる・すき間を付ける）"""

from .features import format_time, parse_time


def _merge_equal_gaps(matches):
    """A・B のギャップが完全一致する連続マッチを1つに結合する。"""
    merged = [matches[0]]
    for match in matches[1:]:
        prev = merged[-1]
        gap_a = parse_time(match["videoA"]["start"]) - parse_time(prev["videoA"]["end"])
        gap_b = parse_time(match["videoB"]["start"]) - parse_time(prev["videoB"]["end"])
        if abs(gap_a - gap_b) < 0.001:  # 1ms以内なら同一とみなす
            prev["videoA"]["end"] = match["videoA"]["end"]
            prev["videoB"]["end"] = match["videoB"]["end"]
            duration = parse_time(prev["videoA"]["end"]) - parse_time(prev["videoA"]["start"])
            prev["duration"] = format_time(duration)
            prev["correlation"] = round((prev["correlation"] + match["correlation"]) / 2, 3)
        else:
            merged.append(match)
    return merged


def _attach_gaps(matches):
    """各マッチに前のマッチからのギャップを付与する。"""
    for idx, match in enumerate(matches):
        if idx == 0:
            continue
        prev = matches[idx - 1]
        gap_a = parse_time(match["videoA"]["start"]) - parse_time(prev["videoA"]["end"])
        gap_b = parse_time(match["videoB"]["start"]) - parse_time(prev["videoB"]["end"])
        match["gap_from_prev"] = {
            "videoA": format_time(max(0.0, gap_a)),
            "videoB": format_time(max(0.0, gap_b)),
        }
