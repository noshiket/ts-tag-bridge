"""トークン・ログイン・利用者の設定"""

import threading
import time
from datetime import datetime, timedelta, timezone
import jwt
from quart import Blueprint, current_app, jsonify, make_response, request


auth_bp = Blueprint('auth', __name__)

_COOKIE = 'ea_token'
_DAYS = 30


def _secret() -> str:
    return current_app.config['ENCODE_AUTO'].get('jwt_secret', 'ea_default_secret_change_me')


def _make_token(user_id: int) -> str:
    payload = {
        'sub': str(user_id),  # PyJWT 2.x は sub を文字列必須とする
        'exp': datetime.now(timezone.utc) + timedelta(days=_DAYS),
    }
    return jwt.encode(payload, _secret(), algorithm='HS256')


def verify_token(token: str, secret: str):
    try:
        payload = jwt.decode(token, secret, algorithms=['HS256'])
        sub = payload.get('sub')
        return int(sub) if sub is not None else None
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def bearer_token() -> str:
    """Authorization: Bearer <token> を取り出す。無ければ空文字。"""
    scheme, _, value = request.headers.get('Authorization', '').partition(' ')
    return value.strip() if scheme.lower() == 'bearer' else ''


def request_token() -> str:
    """アプリは Bearer、ブラウザは Cookie。両方あれば Bearer を優先する。"""
    return bearer_token() or (request.cookies.get(_COOKIE) or '')


# トークン→利用者の短期キャッシュ。同じトークンの連続リクエストで JWT 復号と
# users.db 参照を繰り返さないためのもの（before_request の resolve_user_id と
# perm() 経由の current_user が1リクエストでそれぞれ引いていた）。
# users 行は current_user が必要になるときだけ引く（旧実装と同じ依存関係。
# resolve_user_id は有効な JWT では users.db を触らない）。
# TTL は予約一覧キャッシュと同じ短い時間。利用者の承認状態の変更・アプリトークンの
# 失効はこの時間以内に反映される。アクセス権(user_perms)はここを通らず
# リクエストごとに引くので影響しない。
_USER_CACHE_TTL = 5.0
_user_cache: dict = {}
_user_cache_lock = threading.Lock()
_NO_USER = object()  # キャッシュ内で「まだ users 行を引いていない」印


def _resolve_cached(token: str, secret: str, need_user: bool):
    """token → (user_id, user or None)。need_user のとき user が埋まる。"""
    now = time.monotonic()
    with _user_cache_lock:
        hit = _user_cache.get(token)
        if hit is not None and hit[0] > now and (hit[2] is not _NO_USER or not need_user):
            return hit[1], hit[2]
    user_id = verify_token(token, secret)
    if user_id is None:
        user_id = current_app.config['USERS_DB'].user_id_for_app_token(token)
    user = _NO_USER if user_id else None
    if need_user and user_id:
        user = current_app.config['USERS_DB'].get_user(user_id)
        # 承認を取り消された利用者は、既に持っているトークンでも通さない
        if user and (user.get('status') or 'approved') != 'approved':
            user = None
    with _user_cache_lock:
        _user_cache[token] = (time.monotonic() + _USER_CACHE_TTL, user_id, user)
    return user_id, user


def resolve_user_id(token: str, secret: str):
    """短期JWT（Cookie / Bearer）と、アプリの長期トークンの両方を解く。"""
    return _resolve_cached(token, secret, False)[0]


def request_authenticated() -> bool:
    """このリクエストのトークンが、利用者として解けるか。"""
    token = request_token()
    return bool(token) and resolve_user_id(token, _secret()) is not None


def current_user():
    token = request_token()
    if not token:
        return None
    return _resolve_cached(token, _secret(), True)[1]


# ── 認証 ───────────────────────────────────────────────────────────────

@auth_bp.post('/api/auth/register')
async def register():
    """利用者を登録する（ログイン不要）。body: {username, password（4文字以上）}。

    最初の1人は管理者になり、以降は管理者が承認するまで使えない（承認待ちは管理者へ通知する）。
    """
    db = current_app.config['USERS_DB']
    body = await request.get_json() or {}
    username = body.get('username', '').strip()
    password = body.get('password', '').strip()
    if not username or not password:
        return jsonify({'error': 'username と password は必須です'}), 400
    if len(password) < 4:
        return jsonify({'error': 'パスワードは4文字以上必要です'}), 400
    if db.get_user_by_username(username):
        return jsonify({'error': 'そのユーザー名はすでに使われています'}), 409
    # 最初の1人は管理者。以降は管理者の承認を待つ（勝手に中を見られないように）。
    first = db.count_users() == 0
    status = 'approved' if first else 'pending'
    user_id = db.create_user(username, password, is_admin=first, status=status)
    # 管理者へ通知する（アドオンのフェーズ通知に流す。通知アドオンが有効なら届く）
    try:
        from logic.addons import addon_events
        addon_events.emit('user.registered', {
            'user_id': user_id, 'username': username, 'status': status,
            'title': username, 'station_name': '',
        })
    except Exception:
        pass
    if not first:
        return jsonify({'id': user_id, 'username': username, 'status': status,
                        'message': '登録しました。管理者の承認をお待ちください'}), 202
    token = _make_token(user_id)
    resp = await make_response(jsonify({'id': user_id, 'username': username, 'is_admin': True,
                                        'status': status}))
    resp.set_cookie(_COOKIE, token, httponly=True, samesite='Lax', max_age=_DAYS * 86400)
    return resp, 201


@auth_bp.post('/api/auth/login')
async def login():
    """ログインする（ログイン不要）。body: {username, password}。

    ログインの印を cookie（ea_token）で返し、本文は利用者の情報と権限。承認待ち・断られた利用者は 403。
    """
    db = current_app.config['USERS_DB']
    body = await request.get_json() or {}
    username = body.get('username', '').strip()
    password = body.get('password', '').strip()
    user = db.verify_user(username, password)
    if not user:
        return jsonify({'error': 'ユーザー名またはパスワードが違います'}), 401
    # 承認されるまで入れない（登録できた＝使える、にしない）
    st = user.get('status') or 'approved'
    if st == 'pending':
        return jsonify({'error': 'このアカウントはまだ承認されていません（管理者の承認をお待ちください）'}), 403
    if st == 'rejected':
        return jsonify({'error': 'このアカウントは利用できません'}), 403
    token = _make_token(user['id'])
    from logic import perms
    resp = await make_response(jsonify(
        {'id': user['id'], 'username': user['username'], 'is_admin': user['is_admin'],
         'perms': perms.of(user, db).to_json()}
    ))
    resp.set_cookie(_COOKIE, token, httponly=True, samesite='Lax', max_age=_DAYS * 86400)
    return resp


@auth_bp.post('/api/auth/logout')
async def logout():
    """ログアウトする（ログインの cookie を消す）。"""
    resp = await make_response(jsonify({'ok': True}))
    resp.set_cookie(_COOKIE, '', max_age=0)
    return resp


@auth_bp.get('/api/auth/me')
async def me():
    """ログインしている利用者の情報と権限（perms）。画面の出し分けに使う。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    # 画面の出し分けに使うのでアクセス権も一緒に返す（判定の本体はサーバー側）
    from logic import perms
    return jsonify({**user, 'perms': perms.of(user, current_app.config['USERS_DB']).to_json()})


@auth_bp.post('/api/auth/cookie')
async def refresh_cookie():
    """Authorization の Bearer トークンを、そのまま cookie に入れ直す（アプリのライブ視聴の WebView 用）。
    WebView の映像の取得（mpegts.js・EventSource）は cookie でしか認証を送れない。前に入った HttpOnly の
    古い cookie はページの JS から上書きできず、鍵が変わった後も古い印が送られて 401 が続いた"""
    token = bearer_token()
    if not token or not current_user():
        return jsonify({'error': 'Unauthorized'}), 401
    resp = await make_response(jsonify({'ok': True}))
    resp.set_cookie(_COOKIE, token, httponly=True, samesite='Lax', max_age=_DAYS * 86400)
    return resp


# ── ユーザー設定 ────────────────────────────────────────────────────────


# 好み・入力の履歴の API（auth_bp に載せるので、auth_bp を作った後で読む）
