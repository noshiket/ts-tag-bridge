"""コメントを切り出した区間に合わせる（ドロップでずれた分も直す）"""

import json
from typing import Optional
from .common import logger
from .placeholders import _parse_dt


def _parse_pts_gaps(drop_error_str: Optional[str]) -> list:
    """drop_error から受信断の区間 [(開始TOT, 欠落秒), ...] を開始順で取り出す。"""
    if not drop_error_str:
        return []
    try:
        gaps = (json.loads(drop_error_str) or {}).get('pts_gaps') or []
    except (json.JSONDecodeError, TypeError):
        return []
    out = []
    for g in gaps:
        s = _parse_dt(g.get('start_tot') or '')
        lost = g.get('lost_sec')
        if s and isinstance(lost, (int, float)) and lost > 0:
            out.append((s, float(lost)))
    out.sort(key=lambda x: x[0])
    return out


def _lost_before(pts_gaps: list, seg_start, at) -> float:
    """区間先頭 seg_start から at までの間に失われた再生時間の合計。

    受信断の区間は「そもそも記録されていない」ので、実時刻は進んでいても映像は進まない。
    TOT差分から再生位置を出すときは、その手前までの欠落を引かないと後半ほどずれる。
    """
    total = 0.0
    for g_start, lost in pts_gaps:
        if g_start < seg_start:
            continue
        if g_start >= at:
            break
        # 欠落の途中に当たる場合は、そこまでに進んだぶんだけ引く
        total += min(lost, max(0.0, (at - g_start).total_seconds()))
    return total


# 検出できた欠落の合計を実測値へ合わせる際の安全弁。
# MIN_LOST: これ以下の差は測定誤差(ドロップ0の録画399件で差は中央値-0.05秒/最大0.34秒)。
# MAX_RATIO: 説明できない差が大きすぎる場合は按分せず検出値のまま使う。
_GAP_SCALE_MIN_LOST = 1.0


_GAP_SCALE_MAX_RATIO = 3.0


def _scale_gaps_to_actual(pts_gaps: list, trim_segments: list, encoded_duration) -> list:
    """検出した欠落を、出力の実尺から逆算した実損失に合わせて比例配分する。

    PTSの飛びとして見えるのは「TSに記録されなかった」ぶんだけ。エンコーダは破損箇所の
    前後のGOPごと捨てるので、実際に失われる再生時間はそれより大きい（Zガイア#20 では
    検出58.6秒に対し実損失65.0秒）。

    トリム区間の尺(TOT基準)と出力の実尺の差が実損失。ドロップの無い録画ではこの差は
    ほぼ0(実測399件で中央値-0.05秒)なので、差がある＝欠落があるとみなせる。
    欠落は破損箇所に集中しているため、検出した区間へ比例配分するのが実態に近い。
    """
    if not pts_gaps or not trim_segments or not encoded_duration:
        return pts_gaps
    expected = sum((s.get('duration_sec') or 0) for s in trim_segments)
    if expected <= 0:
        return pts_gaps
    lost = expected - encoded_duration
    detected = sum(g[1] for g in pts_gaps)
    if lost <= _GAP_SCALE_MIN_LOST or detected <= 0 or lost <= detected:
        return pts_gaps
    ratio = lost / detected
    if ratio > _GAP_SCALE_MAX_RATIO:
        logger.warning('run_encoded_analyze: 実損失%.1f秒 に対し検出%.1f秒 と開きが大きいため按分しません',
                       lost, detected)
        return pts_gaps
    return [(start, l * ratio) for start, l in pts_gaps]


def _trim_comments(
    comments_json_str: Optional[str],
    trim_segments: list,
    rec_start_time_str: Optional[str],
    pts_gaps: Optional[list] = None,
) -> Optional[str]:
    """コメント JSON を TOT トリム範囲でフィルタし、time を再ベースした JSON 文字列を返す。"""
    if not comments_json_str or not trim_segments:
        return comments_json_str
    try:
        data = json.loads(comments_json_str)
    except (json.JSONDecodeError, TypeError):
        return comments_json_str

    comments = data.get('comments', [])

    seg_ranges = []
    accumulated = 0.0
    for seg in trim_segments:
        s_dt = _parse_dt(seg.get('start'))
        e_dt = _parse_dt(seg.get('end'))
        if s_dt and e_dt:
            seg_ranges.append((s_dt, e_dt, accumulated))
            accumulated += seg.get('duration_sec', (e_dt - s_dt).total_seconds())

    if not seg_ranges:
        return comments_json_str

    filtered = []
    for c in comments:
        date_dt = _parse_dt(c.get('date', ''))
        if date_dt is None:
            continue
        for s_dt, e_dt, acc in seg_ranges:
            if s_dt <= date_dt <= e_dt:
                nc = dict(c)
                nc['time'] = (acc + (date_dt - s_dt).total_seconds()
                              - _lost_before(pts_gaps or [], s_dt, date_dt))
                filtered.append(nc)
                break

    data['comments'] = filtered
    return json.dumps(data, ensure_ascii=False)
