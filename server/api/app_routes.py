"""ネイティブアプリ専用のエンドポイント（/api/app/...）。

Web クライアントの経路には触らない。ここが失敗しても main.py の
register_blueprint を1行外せば丸ごと切り離せる。
"""
import logging

from quart import Blueprint, current_app, g, jsonify, request

from api.auth_routes.auth import current_user

app_bp = Blueprint('app', __name__, url_prefix='/api/app')

# アプリとサーバーは別々に更新される。アプリはこの番号で互換を判定する。
# 互換を壊す変更を入れた時だけ上げる。
API_VERSION = 1

_VERSION_PATH = '/api/app/version'


@app_bp.before_request
async def _require_auth():
    # 版の確認はログイン前に叩くので認証不要
    if request.path == _VERSION_PATH:
        return None
    # 引いた利用者は g に置く。ハンドラで引き直すと1リクエストで2回 DB を見る
    g.user = current_user()
    if g.user is None:
        return jsonify({'error': 'Unauthorized'}), 401
    return None


@app_bp.get('/version')
async def version():
    """アプリとサーバーの互換の確かめ（ログイン不要）。api（互換を壊した時だけ上がる番号）と使える機能を返す。"""
    return jsonify({
        'api': API_VERSION,
        'features': {
            'bearer': True,       # Authorization: Bearer を受け付ける
            'app_tokens': True,   # 長期トークンの発行・失効ができる
        },
    })


@app_bp.post('/tokens')
async def issue_token():
    """長期トークンを発行する。生の値を返すのはこの応答だけ。"""
    body = await request.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()[:64]
    if not name:
        return jsonify({'error': '端末名を入れてください'}), 400
    token = current_app.config['USERS_DB'].create_app_token(g.user['id'], name)
    return jsonify({'token': token, 'name': name}), 201


@app_bp.get('/tokens')
async def list_tokens():
    """自分が発行した長期トークンの一覧（生の値は含まない）。"""
    return jsonify(current_app.config['USERS_DB'].list_app_tokens(g.user['id']))


@app_bp.delete('/tokens/<int:token_id>')
async def revoke_token(token_id: int):
    """自分の長期トークンを1つ失効させる。"""
    if not current_app.config['USERS_DB'].revoke_app_token(g.user['id'], token_id):
        return jsonify({'error': 'not found'}), 404
    return jsonify({'ok': True})


# アプリの挙動ログ。実機の Xcode コンソールを見なくても、サーバーのログ
# （設定→アプリのログ / ログファイル）で PiP などの動きを追えるようにする。
_app_log = logging.getLogger('ios_app')
# 1回に受ける行数の上限。アプリは数秒ごとにまとめて送るので普段は数十行。
_MAX_LOG_LINES = 500
# 決まって出る計測・状態の行はデバッグ扱い（設定の log_debug をオンにすると出る）。
# PiP の開始・失敗、JS が止まっていた、再生の状態などの出来事は通常のログに残す
_DEBUG_PREFIXES = ('[状態] ', '[監視] 背面で描き直した', '[PiP] 構える', '[PiP] 焼き込む素材',
                   '[PiP] isPictureInPicturePossible=')


def _app_log_level(msg: str) -> int:
    if msg.startswith(_DEBUG_PREFIXES) or (msg.startswith('[PiP] ') and '秒間の送出' in msg):
        return logging.DEBUG
    return logging.INFO


@app_bp.post('/logs')
async def post_logs():
    """アプリの挙動ログを受け取り、サーバーのログ（ios_app）へ書く。

    body: {device, lines: [{t: 端末の時刻, msg}]}。1回に500行まで。決まって出る計測の行はデバッグ扱い。
    """
    body = await request.get_json(silent=True) or {}
    device = str(body.get('device') or '?')[:64]
    lines = body.get('lines') or []
    if not isinstance(lines, list):
        return jsonify({'error': 'lines は配列'}), 400
    for line in lines[:_MAX_LOG_LINES]:
        if not isinstance(line, dict):
            continue
        # 端末側の時刻を残す。送信はまとめて遅れて届くため、受信時刻では前後が分からない
        t = str(line.get('t') or '')[:32]
        msg = str(line.get('msg') or '')[:2000]
        _app_log.log(_app_log_level(msg), '[%s %s] %s', device, t, msg)
    return jsonify({'ok': True, 'accepted': min(len(lines), _MAX_LOG_LINES)})
