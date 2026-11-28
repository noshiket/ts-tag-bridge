"""利用者の好みと入力の履歴（読む・変える）"""

from quart import current_app, jsonify, request
from .auth import auth_bp, current_user


@auth_bp.get('/api/users/me/prefs')
async def get_prefs():
    """自分の好み（見た目・局や時間の絞り込み・非公開カテゴリなど）と、サーバー由来の画面の設定（app_settings）。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    prefs = current_app.config['USERS_DB'].get_prefs(user['id'])
    # サーバー由来のUI設定（config.yml）。利用者ごとの好みではないが、起動時に必ず
    # 引くのがここなので相乗りさせる
    cfg = current_app.config.get('ENCODE_AUTO') or {}
    prefs = dict(prefs)
    prefs['app_settings'] = {'mini_player_height': _mini_player_height(cfg)}
    return jsonify(prefs)


def _mini_player_height(cfg: dict) -> int:
    """フッターのミニプレイヤーの高さ(px)。config.yml の mini_player_height。
    200 より大きい値は「横幅いっぱい」（映像を帯の幅で出し、題名とボタンを下に並べる）で、999 で返す。"""
    try:
        v = int(cfg.get('mini_player_height') or 64)
    except (TypeError, ValueError):
        return 64
    if v > 200:
        return 999
    return max(40, v)


@auth_bp.get('/api/users/me/input_history')
async def get_input_history():
    """入力欄の履歴（欄ごと）。端末を替えても同じ候補を出すため、アカウントに持たせる。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    return jsonify(current_app.config['USERS_DB'].get_input_history(user['id']))


@auth_bp.post('/api/users/me/input_history')
async def change_input_history():
    """1つの欄の履歴を変える。body: {key, push?, remove?, merge?: [..]}。変えた後の一覧を返す。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    body = await request.get_json() or {}
    key = body.get('key')
    if not isinstance(key, str) or not key or len(key) > 64:
        return jsonify({'error': 'key が要ります'}), 400

    def text(v):
        return v[:500] if isinstance(v, str) else None
    merge = body.get('merge')
    merge = [text(v) for v in merge[:50] if isinstance(v, str)] if isinstance(merge, list) else None
    items = current_app.config['USERS_DB'].change_input_history(
        user['id'], key, push=text(body.get('push')), remove=text(body.get('remove')), merge=merge)
    return jsonify({'key': key, 'items': items})


@auth_bp.patch('/api/users/me/prefs')
async def update_prefs():
    """自分の好みを変える。送った項目（tweaks・channel_filter・time_filter・private_categories）だけ置き換える。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    db = current_app.config['USERS_DB']
    body = await request.get_json() or {}
    kwargs = {k: v for k, v in body.items()
              if k in {'tweaks', 'channel_filter', 'time_filter', 'private_categories'}}
    if kwargs:
        db.update_prefs(user['id'], **kwargs)
    return jsonify(db.get_prefs(user['id']))
