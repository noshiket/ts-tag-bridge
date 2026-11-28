"""音楽のプレイリスト（作る・変える・曲を足す/外す/動かす）"""

from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from .music_common import _music_cards, _music_user


@bp.get('/music/playlists')
def list_music_playlists():
    """プレイリスト（フォルダ含む）一覧。並べ替えはクライアント側で行う。"""
    user, users_db = _music_user()
    return jsonify(users_db.list_playlists(user['id']) if user else [])


@bp.post('/music/playlists')
async def create_music_playlist():
    """body: {name, kind:'playlist'|'folder', parent_id}"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    body = await _json()
    name = (body.get('name') or '').strip()
    if not name:
        abort(400, description='name は必須です')
    pid = users_db.create_playlist(user['id'], name, body.get('kind') or 'playlist',
                                   body.get('parent_id'))
    return jsonify(users_db.get_playlist(user['id'], pid)), 201


@bp.patch('/music/playlists/<int:playlist_id>')
async def update_music_playlist(playlist_id):
    """名前変更・フォルダ移動。body: {name?, parent_id?}"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    body = await _json()
    fields = {k: body[k] for k in ('name', 'parent_id') if k in body}
    if not users_db.update_playlist(user['id'], playlist_id, **fields):
        abort(404, description='プレイリストが見つかりません')
    return jsonify(users_db.get_playlist(user['id'], playlist_id))


@bp.delete('/music/playlists/<int:playlist_id>')
def delete_music_playlist(playlist_id):
    """自分のプレイリストを消す。"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    if not users_db.delete_playlist(user['id'], playlist_id):
        abort(404, description='プレイリストが見つかりません')
    return jsonify({'deleted': playlist_id})


@bp.get('/music/playlists/<int:playlist_id>')
def get_music_playlist(playlist_id):
    """プレイリストの中身（曲カードを並び順で）。"""
    db = current_app.config.get('VIDEO_DB')
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    pl = users_db.get_playlist(user['id'], playlist_id)
    if pl is None:
        abort(404, description='プレイリストが見つかりません')
    ids = users_db.playlist_video_ids(user['id'], playlist_id)
    favs = set(users_db.list_music_favorites(user['id']))
    tracks = _music_cards(db, ids, {i: {'favorite': i in favs} for i in ids}) if db else []
    return jsonify({'playlist': pl, 'tracks': tracks})


@bp.post('/music/playlists/<int:playlist_id>/items')
async def add_music_playlist_items(playlist_id):
    """曲を末尾に足す。body: {video_ids:[...]}"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    body = await _json()
    ids = [int(v) for v in (body.get('video_ids') or []) if str(v).isdigit()]
    added = users_db.add_playlist_items(user['id'], playlist_id, ids)
    return jsonify({'added': added, 'video_ids': users_db.playlist_video_ids(user['id'], playlist_id)})


@bp.delete('/music/playlists/<int:playlist_id>/items/<int:video_id>')
def remove_music_playlist_item(playlist_id, video_id):
    """自分のプレイリストから曲を1つ外す。"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    if not users_db.remove_playlist_item(user['id'], playlist_id, video_id):
        abort(404, description='その曲はプレイリストにありません')
    return jsonify({'removed': video_id})


@bp.post('/music/playlists/<int:playlist_id>/items/<int:video_id>/move')
async def move_music_playlist_item(playlist_id, video_id):
    """プレイリスト内の曲を1つ上/下へ動かす。body: {direction:'up'|'down'}"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    body = await _json()
    direction = body.get('direction')
    if direction not in ('up', 'down'):
        abort(400, description="direction は up / down のいずれかです")
    if not users_db.move_playlist_item(user['id'], playlist_id, video_id, direction):
        abort(400, description='動かせませんでした（端、または存在しない曲です）')
    return jsonify({'video_ids': users_db.playlist_video_ids(user['id'], playlist_id)})


@bp.post('/music/playlists/<int:playlist_id>/played')
def touch_music_playlist(playlist_id):
    """最後に再生した日を今にする（並べ替え用）。"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    users_db.touch_playlist_played(user['id'], playlist_id)
    return jsonify({'ok': True})
