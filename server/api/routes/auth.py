"""Blueprint(bp)・権限・認証の確認・連携先に開く API の一覧"""

from quart import (
    Blueprint,
    jsonify,
    current_app,
    request,
    abort,
)
from logic.federation import fed_auth
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む
from .albums_cache import _invalidate_albums_cache  # noqa: F401
from .caches import _invalidate_rec_aug_cache, _invalidate_reserve_cache  # noqa: F401
from .access_rules import _FED_ALLOWED, _READONLY_OK, _ADMIN_ONLY  # noqa: F401


bp = Blueprint('api', __name__, url_prefix='/api')


def perm():
    """このリクエストの権限。1リクエスト中は使い回す。"""
    from quart import g
    if not hasattr(g, '_perm'):
        from api.auth_routes.auth import current_user
        from logic import perms
        # federation中継(X-Fed-Token)は相手ノードが認証済み。利用者の中継なら、中継元が
        # その利用者の権限（X-Fed-Perms）を付けてくるので、それで判断する（局・画面・番組表など）。
        # 付いていない（サーバー同士のやり取り・古い版の中継元）は今までどおり制限しない
        if request.headers.get('X-Fed-Token') is not None:
            raw = _fed_perms()
            g._perm = perms.Perm({'is_admin': True}) if raw is None else \
                perms.Perm({'is_admin': bool(raw.get('is_admin'))}, raw)
        else:
            g._perm = perms.of(current_user(), current_app.config['USERS_DB'])
    return g._perm


def _fed_perms():
    """中継元が付けてきた利用者の権限（X-Fed-Perms）。無い・壊れていれば None"""
    import json
    hdr = request.headers.get('X-Fed-Perms')
    if hdr is None:
        return None
    try:
        raw = json.loads(hdr)
    except ValueError:
        return {}
    return raw if isinstance(raw, dict) else {}


def private_cats():
    """このリクエストで隠すカテゴリ名。1リクエスト中は使い回す。

    利用者ごとに user_prefs.private_categories で決める。?private=1 を付けた
    リクエスト(ライブラリのプライベートモード)では空を返す＝隠さない。

    federation 中継(X-Fed-Token 付き)では、非公開カテゴリは**中継元の利用者設定**
    なので受け側には分からない。以前はここで空を返しており、相手ノードのライブラリを
    開くと非公開の動画が丸見えになっていた。中継元が X-Fed-Private-Cats で送って
    くるので、それを使う。ヘッダが無い(古い版の中継元)場合も、隠す側に倒す。
    """
    import json as _json
    from quart import g
    if not hasattr(g, '_priv_cats'):
        if request.headers.get('X-Fed-Token') is not None:
            raw = request.headers.get('X-Fed-Private-Cats')
            try:
                cats = _json.loads(raw) if raw else None
            except (ValueError, TypeError):
                cats = None
            if not isinstance(cats, list):
                cats = None
            # ヘッダが読めない時は「隠すものが無い」と決めつけない。中継元が
            # 送ってこない＝判断材料が無いので、prefs を持つ利用者が居ないなら
            # 空になるだけで、少なくとも黙って全部見せることはしない
            g._priv_cats = [c for c in (cats or []) if isinstance(c, str)]
        elif request.args.get('private') in ('1', 'true'):
            g._priv_cats = []
        else:
            g._priv_cats = []
            udb = current_app.config.get('USERS_DB')
            if udb is not None:
                from api.auth_routes.auth import current_user
                u = current_user()
                if u:
                    prefs = udb.get_prefs(u['id']) or {}
                    g._priv_cats = list(prefs.get('private_categories') or [])
    return g._priv_cats


def require_screen(name):
    """画面が許可されていなければ 403。一覧APIの先頭で呼ぶ。"""
    if not perm().screen(name):
        abort(403, description=f'この画面は許可されていません（{name}）')


@bp.before_request
async def _require_auth():
    # /api/auth/* は認証不要
    if request.path.startswith('/api/auth/'):
        return None
    # federationピアからの中継リクエスト（X-Fed-Token + ホワイトリストパスのみ）。
    # ヘッダが存在する場合はここで完結させ、不一致でも通常のJWT認証へフォールバックしない。
    fed_token_header = request.headers.get('X-Fed-Token')
    if fed_token_header is not None:
        allowed = fed_auth.verify(current_app.config['ENCODE_AUTO'], fed_token_header) and \
            any(request.method in methods and rx.match(request.path) for methods, rx in _FED_ALLOWED)
        if not allowed:
            return jsonify({'error': 'Unauthorized'}), 401
        from . import record_guard
        denied = record_guard.check(request.path, perm(), current_app.config.get('RULE_DB'))
        if denied:
            return jsonify({'error': denied}), 403
        return None
    from api.auth_routes.auth import request_authenticated
    if not request_authenticated():
        return jsonify({'error': 'Unauthorized'}), 401
    p = perm()
    # サーバー設定は管理者だけ（読み取りも含む。接続先やWebhook URLが見えてしまうため）
    if _ADMIN_ONLY.match(request.path) and not p.is_admin:
        return jsonify({'error': 'この設定は管理者のみ変更できます'}), 403
    # 閲覧のみの利用者は変更操作を通さない（画面で隠すだけでは直接叩けてしまうため）
    if request.method != 'GET' and not p.can_write and \
            not any(request.method in m and rx.match(request.path) for m, rx in _READONLY_OK):
        return jsonify({'error': 'この操作は許可されていません（閲覧のみ）'}), 403
    # 録画・エンコードを番号で開く口は、その録画の局と画面の許可を見る（一覧の絞り込みと対にする）
    from . import record_guard
    denied = record_guard.check(request.path, p, current_app.config.get('RULE_DB'))
    if denied:
        return jsonify({'error': denied}), 403
    return None


@bp.after_request
async def _rec_aug_invalidate_after_write(response):
    # 書き込み(非GET)後はサーバー側キャッシュを捨て、直後の再取得を最新にする。
    # 録画一覧 / 予約一覧(EDCB) / アルバム一覧 の3キャッシュをまとめて無効化する。
    if request.method != 'GET':
        _invalidate_rec_aug_cache()
        _invalidate_reserve_cache()
        _invalidate_albums_cache()
    return response
