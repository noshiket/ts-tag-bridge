"""字幕とドロップの記録を切り出した区間に合わせる"""

import json
from datetime import timedelta
from typing import Optional
from .placeholders import _parse_dt
from .comment_trim import _lost_before


def _trim_captions(
    captions_json_str: Optional[str],
    trim_segments: list,
    pts_gaps: Optional[list] = None,
) -> Optional[str]:
    """字幕 JSON を TOT トリム範囲でフィルタし、pts と base_tot を再ベースした JSON 文字列を返す。"""
    if not captions_json_str or not trim_segments:
        return captions_json_str
    try:
        data = json.loads(captions_json_str)
    except (json.JSONDecodeError, TypeError):
        return captions_json_str

    captions = data.get('captions', [])

    seg_ranges = []
    accumulated = 0.0
    for seg in trim_segments:
        s_dt = _parse_dt(seg.get('start'))
        e_dt = _parse_dt(seg.get('end'))
        if s_dt and e_dt:
            seg_ranges.append((s_dt, e_dt, accumulated))
            accumulated += seg.get('duration_sec', (e_dt - s_dt).total_seconds())

    if not seg_ranges:
        return captions_json_str

    first_seg_start = seg_ranges[0][0]

    filtered = []
    for cap in captions:
        tot_dt = _parse_dt(cap.get('tot', ''))
        if tot_dt is None:
            continue
        for s_dt, e_dt, acc in seg_ranges:
            if s_dt <= tot_dt <= e_dt:
                nc = dict(cap)
                nc['pts'] = (acc + (tot_dt - s_dt).total_seconds()
                             - _lost_before(pts_gaps or [], s_dt, tot_dt))
                filtered.append(nc)
                break

    data['captions'] = filtered
    data['base_tot'] = first_seg_start.isoformat()
    return json.dumps(data, ensure_ascii=False)


def _trim_drop_error(
    drop_error_str: Optional[str],
    trim_segments: list,
    rec_start: Optional[str] = None,
    rec_end: Optional[str] = None,
) -> Optional[str]:
    """drop_error JSON を TOT トリム範囲でフィルタした JSON 文字列を返す。

    errors は tot_time でフィルタし、drop_count/other_count も再計算する。
    scramble_ranges はバイト位置しか持たないため、録画のTOT区間[rec_start, rec_end]と
    total_packets のCBR近似(drops API と同じ前提)で位置⇔時刻を対応させてトリムし、
    scramble_count を残存レンジ内のパケット数合計で再計算する。
    rec_start/rec_end が取れない場合、scramble は従来どおり全TS値のまま残す。
    """
    if not drop_error_str or not trim_segments:
        return drop_error_str
    try:
        data = json.loads(drop_error_str)
    except (json.JSONDecodeError, TypeError):
        return drop_error_str

    def _naive(s):
        dt = _parse_dt(s) if s else None
        return dt.replace(tzinfo=None) if dt is not None else None

    seg_ranges = []
    for seg in trim_segments:
        s_dt = _naive(seg.get('start'))
        e_dt = _naive(seg.get('end'))
        if s_dt and e_dt:
            seg_ranges.append((s_dt, e_dt))

    if not seg_ranges:
        return drop_error_str

    filtered = []
    for e in data.get('errors', []):
        tot_dt = _naive(e.get('tot_time', ''))
        if tot_dt is None:
            continue
        if any(s_dt <= tot_dt <= e_dt for s_dt, e_dt in seg_ranges):
            filtered.append(e)

    data['errors'] = filtered
    # pts_gaps は TOT を持つのでそのままトリムできる。エンコード後も残しておかないと、
    # 再生位置の補正(字幕/コメント/続き再生)が video 側からできなくなる。
    if data.get('pts_gaps'):
        data['pts_gaps'] = [g for g in data['pts_gaps']
                            if (lambda t: t is not None and any(s <= t <= e for s, e in seg_ranges))
                            (_naive(g.get('start_tot') or ''))]
    drop_cnt = sum(1 for e in filtered if e.get('error_type') == 'PACKET_LOSS')
    other_cnt = len(filtered) - drop_cnt
    data['drop_count'] = drop_cnt
    data['other_count'] = other_cnt

    # scramble_ranges のトリム（CBR近似の位置⇔時刻対応）
    scr_ranges = data.get('scramble_ranges') or []
    s_dt0 = _naive(rec_start)
    e_dt0 = _naive(rec_end)
    total_bytes = (data.get('total_packets') or 0) * 188
    if scr_ranges and s_dt0 and e_dt0 and e_dt0 > s_dt0 and total_bytes > 0:
        span = (e_dt0 - s_dt0).total_seconds()

        def _pos_to_dt(pos):
            frac = min(max((pos or 0) / total_bytes, 0.0), 1.0)
            return s_dt0 + timedelta(seconds=frac * span)

        def _dt_to_pos(dt):
            frac = min(max((dt - s_dt0).total_seconds() / span, 0.0), 1.0)
            return int(frac * total_bytes)

        kept = []
        for r in scr_ranges:
            rs = r.get('start_position', 0) or 0
            re_ = r.get('end_position', 0) or 0
            rs_dt, re_dt = _pos_to_dt(rs), _pos_to_dt(re_)
            for seg_s, seg_e in seg_ranges:
                ov_s, ov_e = max(rs_dt, seg_s), min(re_dt, seg_e)
                if ov_s < ov_e:
                    kept.append({'start_position': max(rs, _dt_to_pos(ov_s)),
                                 'end_position': min(re_, _dt_to_pos(ov_e))})
        data['scramble_ranges'] = kept
        data['scramble_count'] = sum(
            max(0, (k['end_position'] - k['start_position']) // 188 + 1) for k in kept)

    data['error_count'] = drop_cnt + other_cnt + (data.get('scramble_count') or 0)
    return json.dumps(data, ensure_ascii=False)
