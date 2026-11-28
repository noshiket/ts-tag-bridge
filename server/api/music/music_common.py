"""音楽の API で共通の扱い（利用者・曲のカード）"""

from quart import current_app
from api.routes.auth import private_cats


def _music_user():
    """ログイン中の利用者と USERS_DB。どちらか無ければ (None, None)。"""
    from api.auth_routes.auth import current_user
    users_db = current_app.config.get('USERS_DB')
    user = current_user()
    return (user, users_db) if (user and users_db is not None) else (None, None)


def _music_cards(db, ids, extra=None):
    """id 順を保ったままカードにする。extra は id→追加情報の dict。"""
    cards = {c['id']: c for c in db.get_video_cards(list(ids), private_categories=private_cats())}
    out = []
    for vid in ids:
        c = cards.get(vid)
        if not c:
            continue
        out.append({**c, **((extra or {}).get(vid) or {})})
    return out
