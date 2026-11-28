"""キャプチャの持ち主（アカウントごとに、自分の撮った物だけを見せる）。

持ち主は「利用者名@その利用者のいるサーバー」。アカウントはサーバーごとなので、別のサーバーの
画面から中継で撮った物や、動画と一緒に送られてきた物も、元のサーバーの利用者として見分ける。
持ち主の無い物（この仕組みより前の物・手で置いた画像）は管理者だけに見せる。
"""

from quart import abort, current_app, request


def owner_key(username: str) -> str:
    node = (current_app.config['ENCODE_AUTO'].get('federation') or {}).get('node_id')
    return f'{username}@{node}' if node else username


def me():
    """このリクエストの利用者の印。サーバー同士のやり取り（利用者なし）は None"""
    from api.routes.auth import _fed_perms
    if request.headers.get('X-Fed-Token') is not None:
        return (_fed_perms() or {}).get('user')
    from api.auth_routes.auth import current_user
    u = current_user()
    return owner_key(u['username']) if u and u.get('username') else None


def visible(owner) -> bool:
    from api.routes.auth import _fed_perms, perm
    if request.headers.get('X-Fed-Token') is not None and _fed_perms() is None:
        return True                       # サーバー同士のやり取り
    if owner:
        return owner == me()
    return perm().is_admin


def require_visible(db, fname: str) -> None:
    """ファイル名で1枚を開く・消す口。他の人の物は無いことにする（404）"""
    row = db.get_capture_by_path(fname) if db is not None else None
    if not visible((row or {}).get('owner')):
        abort(404)
