"""アルバムの「新着」: 放送局ごとに、1 週間以内に見終えた話の次の話が、その局でその後に放送され、まだ見ていない。

- 局は (onid, sid) で分ける。同じ話を別の局で録った重複があっても、見ている局の流れだけで決める
- 次の話は、話数が数字なら「その局で最後に見た話数 + 1」。数字でなければ、その局で放送の順で次のもの
- 次の話をどれかの局で見終えていれば新着にしない（話数が同じものは同じ話）
- 見終えたのが 1 週間より前の局は見ない（多くは週 1 の放送。追いかけていない番組を新着にしない）
- 日時は放送の開始で見る（追加日時はライブラリへの入れ直しで変わるので使わない。放送日時が無い時だけ追加日時）
- 見終えた = 進み具合が WATCH_COMPLETE_RATIO 以上、または最後まで見た回数が 1 以上
"""

from datetime import datetime, timedelta, timezone


def _utc(s):
    """日時の文字列（視聴履歴は UTC の ISO で末尾 Z、放送開始は時差付き、追加日時は現地時刻で時差なし）を UTC に"""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.astimezone(timezone.utc)


def _num(ep):
    try:
        return float(ep)
    except (TypeError, ValueError):
        return None


def _ep(v):
    """話の見分け（話数。無ければ動画ごと）"""
    return (v.get('episode_number') or '').strip() or f"#{v['video_id']}"


def _aired(v):
    return _utc(v.get('start') or v.get('created_at'))


def new_episode_albums(rows, watch, complete_ratio=0.9, now=None, window_days=7):
    """新着のあるアルバムの id の集合。

    rows: 動画ごとの dict（video_id, series_id, album_id, episode_number, onid, sid, start, created_at）。start は放送開始
    watch: {video_id: (updated_at, progress, play_count)}（この利用者の視聴履歴）
    """
    now = now or datetime.now(timezone.utc)

    def done_at(v):
        w = watch.get(v['video_id'])
        if not w or not ((w[1] or 0) >= complete_ratio or (w[2] or 0) > 0):
            return None
        return _utc(w[0])

    series = {}
    for r in rows:
        series.setdefault((r['album_id'], r['series_id']), []).append(r)
    found = set()
    for (album_id, _sid), vids in series.items():
        if album_id in found:
            continue
        seen_eps = {_ep(v) for v in vids if done_at(v)}
        stations = {}
        for v in vids:
            stations.setdefault((v.get('onid'), v.get('sid')), []).append(v)
        for svids in stations.values():
            svids.sort(key=lambda v: _aired(v) or now)
            watched = [(done_at(v), v) for v in svids if done_at(v)]
            if not watched:
                continue
            last_at, last = max(watched, key=lambda x: x[0])
            if now - last_at > timedelta(days=window_days):
                continue
            n = _num(last.get('episode_number'))
            if n is not None:
                nxt = next((v for v in svids if _num(v.get('episode_number')) == n + 1), None)
            else:
                i = svids.index(last)
                nxt = svids[i + 1] if i + 1 < len(svids) else None
            if nxt is None or _ep(nxt) in seen_eps:
                continue
            aired = _aired(nxt)
            if aired and aired > last_at:
                found.add(album_id)
                break
    return found
