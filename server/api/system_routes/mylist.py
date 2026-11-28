"""マイリストとストレージ"""

from quart import (
    jsonify,
    current_app,
)
from api import schemas
from api.routes.auth import bp, private_cats  # noqa: F401
from api.routes.edcb_call import _call, _client  # noqa: F401
from api.routes.albums_cache import _get_albums_cached  # noqa: F401


@bp.get('/users/me/mylist')
def get_mylist():
    """マイリスト(お気に入りアルバム)の album_id 一覧。追加が新しい順。"""
    from api.auth_routes.auth import current_user
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    users_db = current_app.config.get('USERS_DB')
    ids = users_db.list_mylist(user['id']) if users_db else []
    # video.db から消えたアルバムは返さない(DBが別で外部キーを張れないため)
    db = current_app.config.get('VIDEO_DB')
    if db is not None and ids:
        # 音楽アーティストのアルバムも対象なので種別で絞らない（=別キャッシュを引く）
        alive = {a['id'] for a in _get_albums_cached(
            db, (current_app.config['ENCODE_AUTO'].get('encode_dir_list') or []),
            private_cats(), None)}
        ids = [i for i in ids if i in alive]
    return jsonify({'album_ids': ids})


@bp.put('/users/me/mylist/<int:album_id>')
def add_mylist(album_id):
    """アルバムを自分のマイリストに足す。"""
    from api.auth_routes.auth import current_user
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    current_app.config['USERS_DB'].add_mylist(user['id'], album_id)
    return jsonify({'in_mylist': True})


@bp.delete('/users/me/mylist/<int:album_id>')
def delete_mylist(album_id):
    """アルバムを自分のマイリストから外す。"""
    from api.auth_routes.auth import current_user
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    current_app.config['USERS_DB'].remove_mylist(user['id'], album_id)
    return jsonify({'in_mylist': False})


# ---------------------------------------------------------------------------
# システム情報
# ---------------------------------------------------------------------------

@bp.get('/storage')
def get_storage():
    """EDCB の録画先のディスクの空き。"""
    items = _call(_client().get_storage)
    if isinstance(items, list):
        return jsonify([schemas.storage_to_response(s) for s in items])
    return jsonify(items)
