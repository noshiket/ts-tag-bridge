"""字幕・コメントを相手の時間へ写す・取り込んだトラックの名前"""

import uuid
from datetime import datetime
from .remap import _EDGE_EXTRAPOLATE_SEC, remap


def _hole_starts(ranges, duration=None) -> list:
    """取り込み先(A)の時間軸で、対応が無い区間の始まりを返す。"""
    if not ranges:
        return []
    spans = sorted((b0 + off, b1 + off) for b0, b1, off in ranges)
    out = []
    for i in range(len(spans) - 1):
        if spans[i + 1][0] - spans[i][1] > 0.001:
            out.append(spans[i][1])
    # 末尾より後ろ（端の外挿ぶんを除く）も対応が無い
    tail = spans[-1][1] + _EDGE_EXTRAPOLATE_SEC
    if duration is None or tail < duration:
        out.append(tail)
    return out


def remap_captions(captions, ranges, duration=None) -> list:
    """字幕エントリ(pts)を付け替える。対応先が無いものは落とす。

    tot(絶対時刻)は取り込み元の放送時刻で、取り込み先では意味を持たないので捨てる。

    落とした所には画面消去(ClearScreen)を1つ置く。ARIB字幕は次の消去が来るまで
    出しっぱなしなので、消去を含むエントリが穴に落ちると前の字幕が画面に残り続ける
    （次に残った消去まで＝数分に及ぶことがある）。
    """
    out = []
    for cap in captions or []:
        if not isinstance(cap, dict) or not cap.get('tokens'):
            continue
        t = remap(cap.get('pts', 0.0), ranges, duration)
        if t is None:
            continue
        out.append({
            'pts': round(t, 3),
            'duration_ms': cap.get('duration_ms'),
            'clear_screen': bool(cap.get('clear_screen', False)),
            'tokens': cap['tokens'],
        })
    out.sort(key=lambda c: c['pts'])
    if out:
        for h in _hole_starts(ranges, duration):
            # 穴の手前に字幕があり、穴の始まりに消去が無い時だけ足す
            if not any(c['pts'] <= h for c in out):
                continue
            if any(abs(c['pts'] - h) < 0.5 and c['clear_screen'] for c in out):
                continue
            out.append({'pts': round(h, 3), 'duration_ms': None,
                        'clear_screen': True, 'tokens': [{'tag': 'ClearScreen'}]})
        out.sort(key=lambda c: c['pts'])
    return out


def remap_comments(comments, ranges, duration=None) -> list:
    """コメント(time)を付け替える。対応先が無いものは落とす。"""
    out = []
    for c in comments or []:
        if not isinstance(c, dict):
            continue
        t = remap(c.get('time', 0.0), ranges, duration)
        if t is None:
            continue
        nc = dict(c)
        nc['time'] = round(t, 3)
        out.append(nc)
    out.sort(key=lambda c: c['time'])
    return out


def track_name(source_row: dict) -> str:
    """取り込み元の録画時刻とチャンネルからトラック名を作る（例: 20260213-2300 BSあさぎ1）。"""
    ts = (source_row or {}).get('recording_start_time') or (source_row or {}).get('eit_start_time') or ''
    stamp = ''
    try:
        stamp = datetime.fromisoformat(str(ts)).strftime('%Y%m%d-%H%M')
    except (ValueError, TypeError):
        stamp = str(ts)[:16].replace('-', '').replace('T', '-').replace(':', '')
    station = (source_row or {}).get('eit_station_name') or ''
    return ' '.join(x for x in (stamp, station) if x) or '取り込み字幕'


def unique_name(base: str, existing) -> str:
    """既存の名前と衝突しないよう末尾に連番を付ける。"""
    names = set(existing or [])
    if base not in names:
        return base
    for i in range(2, 100):
        cand = f'{base} ({i})'
        if cand not in names:
            return cand
    return f'{base} ({uuid.uuid4().hex[:4]})'
