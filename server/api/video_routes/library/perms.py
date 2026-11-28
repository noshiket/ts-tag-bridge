"""見てよい動画だけにする（権限での絞り込み）"""

from quart import current_app, abort
from api.routes.auth import perm


def _visible_video_ids(ids):
    """渡した video.id のうち、見てよいものだけを返す。"""
    p = perm()
    ids = [i for i in ids if i is not None]
    if not p.limits_videos or not ids:
        return set(ids)
    sql, params = p.video_ids_sql()
    db = current_app.config.get('VIDEO_DB')
    if db is None or sql is None:
        return set(ids)
    ph = ','.join('?' * len(ids))
    rows = db._get_conn().execute(f'SELECT id FROM ({sql}) WHERE id IN ({ph})',
                                  list(params) + list(ids)).fetchall()
    return {r[0] for r in rows}


def _perm_visible_videos(items):
    """video 相当の dict 一覧から、許可外のものを落とす。"""
    if not perm().limits_videos:
        return items
    ok = _visible_video_ids([it.get('id') for it in items])
    return [it for it in items if it.get('id') in ok]


def _perm_prune_videos(detail):
    """アルバム/シリーズ/カテゴリ詳細の videos を許可されたものだけにする。

    中身が全部許可外なら 403（一覧に出ないものをID直打ちで開けないように）。
    """
    p = perm()
    if not p.limits_videos or not isinstance(detail, dict):
        return detail
    groups = detail.get('series') if isinstance(detail.get('series'), list) else None
    all_ids = [v.get('id') for v in (detail.get('videos') or [])]
    for g in (groups or []):
        all_ids += [v.get('id') for v in (g.get('videos') or [])]
    ok = _visible_video_ids(all_ids)
    if all_ids and not ok:
        abort(403, description='この内容は許可されていません')
    if detail.get('videos') is not None:
        detail['videos'] = [v for v in detail['videos'] if v.get('id') in ok]
    if groups is not None:
        for g in groups:
            g['videos'] = [v for v in (g.get('videos') or []) if v.get('id') in ok]
        detail['series'] = [g for g in groups if g['videos']]
    return detail
