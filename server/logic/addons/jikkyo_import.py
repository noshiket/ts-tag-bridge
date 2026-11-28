"""コメントを取り込むアドオンの共通処理。

投稿(実時刻)を trim_segments の TOT と突き合わせて動画内の再生位置へ変換し、
tag.json の comments_json へマージする。サイトごとの取得・パース・トラック名の決め方は
アドオン側が持つ（サイトによって HTML の形も取り方も違い、片方の変更が他方に波及しないようにする）。
"""

import json
import re
from datetime import datetime


def split_list(raw):
    """改行またはカンマ区切りの文字列をリストにする。"""
    if not raw:
        return []
    return [s.strip() for s in re.split(r'[\r\n,]+', str(raw)) if s.strip()]


def parse_dt(v):
    """ISO8601 でも "YYYY-MM-DD HH:MM:SS.ffffff" でも読む。tz は落として素の時刻で扱う。"""
    s = str(v).strip().replace('T', ' ')
    s = re.sub(r'(\+\d{2}:\d{2}|Z)$', '', s)
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f'時刻を解釈できません: {v!r}')


def segments(tag):
    """trim_segments を [(開始dt, 終了dt, 動画内オフセット秒)] にする。

    trim_segments は採用区間の TOT 絶対時刻。CMカット済みなら区間が飛び飛びになるので、
    区間長を積み上げた値が動画内の位置になる。
    """
    raw = tag.get('trim_segments')
    if isinstance(raw, str):
        raw = json.loads(raw or '[]')
    if not raw:
        raise ValueError('trim_segments がありません（この動画は放送時刻との対応が取れません）')
    out, acc = [], 0.0
    for seg in raw:
        s = seg.get('start') or seg.get('start_tot')
        e = seg.get('end') or seg.get('end_tot')
        if not s or not e:
            continue
        s_dt, e_dt = parse_dt(s), parse_dt(e)
        out.append((s_dt, e_dt, acc))
        acc += seg.get('duration_sec') or (e_dt - s_dt).total_seconds()
    if not out:
        raise ValueError('trim_segments を解釈できませんでした')
    return out


def compile_ng(ng_words_raw, ng_regex_raw):
    """NGワード(部分一致)とNG正規表現を用意する。"""
    return split_list(ng_words_raw), [re.compile(p) for p in split_list(ng_regex_raw)]


def map_posts(posts, segs, ng_words, ng_res, author_prefix):
    """投稿を動画内位置へ変換する。戻り値: (コメント配列, NG除外数, 放送時間外数)"""
    mapped, ng_count, outside = [], 0, 0
    for p in posts:
        body = p['content']
        if any(w in body for w in ng_words) or any(r.search(body) for r in ng_res):
            ng_count += 1
            continue
        for s_dt, e_dt, offset in segs:
            if s_dt <= p['dt'] <= e_dt:
                mapped.append({
                    'time': round(offset + (p['dt'] - s_dt).total_seconds(), 3),
                    'text': body,
                    'color': '#FFFFFF',
                    'type': 'right',
                    'author': f'{author_prefix}:{p["user_id"]}',
                })
                break
        else:
            outside += 1
    return mapped, ng_count, outside


def merge_into_tag(ctx, mapped, track_name):
    """tag.json の comments_json へマージする。戻り値: (追加数, トラック名, トラック件数)

    (time, author, text) で重複判定するため、同じスレを取り直しても二重にならない。
    """
    raw = ctx.tag.get('comments_json')
    cur = json.loads(raw) if isinstance(raw, str) else (raw or {})
    if not isinstance(cur, dict):
        cur = {'comments': cur if isinstance(cur, list) else []}
    cur.setdefault('comments', [])

    track = (track_name or '').strip() or 'comments'
    existing = cur.get(track) if isinstance(cur.get(track), list) else []
    keys = {(c.get('time'), c.get('author'), c.get('text')) for c in existing}
    added = [c for c in mapped if (c['time'], c['author'], c['text']) not in keys]
    merged = existing + added
    merged.sort(key=lambda c: c['time'])
    cur[track] = merged
    ctx.tag['comments_json'] = cur
    ctx.tag['comment_count'] = len(cur.get('comments') or [])
    ctx.save_tag()
    ctx.apply_tag_to_db()
    return len(added), track, len(merged)
