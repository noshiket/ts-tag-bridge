"""録画のドロップの位置（再生の時刻へ直す）"""

import json
from datetime import datetime, timedelta


def _drops_naive_dt(s):
    """ISO8601 文字列を naive datetime にする（aware はローカル時刻へ正規化）。"""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    return dt.astimezone().replace(tzinfo=None) if dt.tzinfo is not None else dt


def _build_drops_payload(raw, duration, rec_start, rec_end, trim_segments=None):
    """drop_error JSON から {"drops": [sec, ...], "scramble": [{start, end}, ...]} を作る。

    ドロップの秒位置は各エラーが持つ tot_time(絶対時刻)を基準にする。バイト位置を
    CBR 近似(位置÷総バイト×尺)で秒に直す方法は可変ビットレートの TS で大きくズレるため。
    trim_segments があれば(=ライブラリ動画のようにトリム済みの出力)、tot_time を各区間へ
    写像して出力タイムラインの秒に直す。無ければ rec_start からの経過秒。
    tot_time も基準時刻も無い旧データは、従来どおり CBR 近似にフォールバックする。

    scramble_ranges はバイト位置しか持たないため、録画区間 [rec_start, rec_end] に対する
    CBR 近似で時刻へ直してから、ドロップと同じ写像を通す(_trim_drop_error と同じ手法)。
    """
    out = {'drops': [], 'scramble': []}
    if not raw or duration <= 0:
        return out
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return out
    if not isinstance(d, dict):
        return out

    total_bytes = (d.get('total_packets') or 0) * 188
    start_dt = _drops_naive_dt(rec_start)
    end_dt = _drops_naive_dt(rec_end)

    # トリム区間 [(開始時刻, 終了時刻, 出力タイムラインでの開始秒), ...]
    seg_ranges = []
    if trim_segments:
        acc = 0.0
        for seg in trim_segments:
            s_dt = _drops_naive_dt(seg.get('start'))
            e_dt = _drops_naive_dt(seg.get('end'))
            if s_dt and e_dt:
                seg_ranges.append((s_dt, e_dt, acc))
                acc += float(seg.get('duration_sec') or (e_dt - s_dt).total_seconds())

    def _clamp(sec):
        return max(0.0, min(duration, sec))

    def _dt_to_sec(dt):
        """絶対時刻 → 出力タイムラインの秒。範囲外(カットされた区間)は None。"""
        if dt is None:
            return None
        if seg_ranges:
            for s_dt, e_dt, acc in seg_ranges:
                if s_dt <= dt <= e_dt:
                    return _clamp(acc + (dt - s_dt).total_seconds())
            return None
        if start_dt is None:
            return None
        return _clamp((dt - start_dt).total_seconds())

    def _cbr_sec(pos):
        """フォールバック: バイト位置の CBR 近似（旧データ用）。"""
        if total_bytes <= 0:
            return None
        return _clamp((pos or 0) / total_bytes * duration)

    def _pos_to_dt(pos):
        """バイト位置 → 絶対時刻（録画区間に対する CBR 近似）。"""
        if total_bytes <= 0 or start_dt is None or end_dt is None or end_dt <= start_dt:
            return None
        frac = min(max((pos or 0) / total_bytes, 0.0), 1.0)
        return start_dt + timedelta(seconds=frac * (end_dt - start_dt).total_seconds())

    # ドロップ(PACKET_LOSS)のみ。整数秒バケットで集約し、同時刻の多 PID ドロップを1点にまとめる
    buckets = set()
    for e in (d.get('errors') or []):
        if e.get('error_type') != 'PACKET_LOSS':
            continue
        sec = _dt_to_sec(_drops_naive_dt(e.get('tot_time')))
        if sec is None and not seg_ranges:
            # tot_time が無い旧データのみ CBR 近似で救済する（トリム済みの出力では
            # 元 TS 基準の位置を出力尺に掛けても意味が無いため使わない）
            sec = _cbr_sec(e.get('position', 0))
        if sec is not None:
            buckets.add(int(sec))
    out['drops'] = sorted(buckets)

    for r in (d.get('scramble_ranges') or []):
        s = _dt_to_sec(_pos_to_dt(r.get('start_position', 0)))
        en = _dt_to_sec(_pos_to_dt(r.get('end_position', 0)))
        if s is None and en is None and not seg_ranges:
            s = _cbr_sec(r.get('start_position', 0))
            en = _cbr_sec(r.get('end_position', 0))
        if s is None and en is None:
            continue
        s = s if s is not None else 0.0
        en = en if en is not None else duration
        out['scramble'].append({'start': s, 'end': max(en, s)})

    return out
