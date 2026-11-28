"""音楽（/api/music/*）。

api/routes.py から分けた。Blueprint(bp) と共通の補助は api.routes にある。
"""

from quart import jsonify, current_app, request, abort

from api.routes.auth import bp, perm, private_cats, require_screen  # noqa: F401
from api.routes.albums_cache import _get_albums_cached  # noqa: F401
from .music_common import _music_user, _music_cards  # noqa: F401


@bp.get('/music/overview')
def music_overview():
    """ミュージックタブの初期表示。最近聴いた曲・よく聴く曲・アーティスト一覧を返す。

    音楽は video.db に media_kind='audio' で入っており、album=アーティスト /
    series=アルバム名 / video=曲（episode_number=トラック番号, episode_name=曲名）。
    アーティストの中身は既存の GET /api/videos/albums/<id> で辿れる。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify({'artists': [], 'recent': [], 'top': []})
    require_screen('library')
    limit = min(100, max(1, request.args.get('limit', default=24, type=int)))
    priv = private_cats()
    dir_roots = (current_app.config['ENCODE_AUTO'].get('encode_dir_list') or [])
    p = perm()
    artists = (db.get_albums(dir_roots, p.video_conds(), private_categories=priv, media_kind='audio')
               if p.limits_videos else _get_albums_cached(db, dir_roots, priv, 'audio'))

    # 最近聴いた/よく聴くは視聴履歴から。曲(audio)のエントリだけ拾う
    recent, top = [], []
    users_db = current_app.config.get('USERS_DB')
    from api.auth_routes.auth import current_user
    user = current_user()
    if users_db is not None and user:
        audio_ids = {r['id'] for r in db._get_conn().execute(
            "SELECT id FROM videos WHERE media_kind='audio'")}
        entries = []
        for r in users_db.get_watch_history(user['id'], limit=1000):
            if r['last_type'] != 'video':
                continue
            try:
                vid = int(r['last_id'])
            except (TypeError, ValueError):
                continue
            if vid in audio_ids:
                entries.append((vid, r['updated_at'], r['play_count'] or 0))
        recent_ids = [e[0] for e in entries][:limit]
        top_ids = [e[0] for e in sorted(entries, key=lambda e: -e[2]) if e[2] > 0][:limit]
        cards = {c['id']: c for c in
                 db.get_video_cards(list(dict.fromkeys(recent_ids + top_ids)),
                                    private_categories=priv)}
        info = {e[0]: e for e in entries}
        def _card(vid):
            c = cards.get(vid)
            if not c:
                return None
            e = info.get(vid)
            return {**c, 'played_at': e[1] if e else None, 'play_count': e[2] if e else 0}
        recent = [c for c in (_card(v) for v in recent_ids) if c]
        top = [c for c in (_card(v) for v in top_ids) if c]

    return jsonify({'artists': artists, 'recent': recent, 'top': top})


@bp.get('/music/artists')
def music_artists():
    """アーティスト一覧（音楽の album）。sort=name|added|title"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    require_screen('library')
    dir_roots = (current_app.config['ENCODE_AUTO'].get('encode_dir_list') or [])
    p = perm()
    priv = private_cats()
    artists = (db.get_albums(dir_roots, p.video_conds(), private_categories=priv, media_kind='audio')
               if p.limits_videos else list(_get_albums_cached(db, dir_roots, priv, 'audio')))
    sort = request.args.get('sort') or 'name'
    if sort == 'added':
        artists.sort(key=lambda a: (a.get('latest_video_at') or ''), reverse=True)
    else:  # name / title は同じ（アーティスト名）
        artists.sort(key=lambda a: (a.get('name') or '').lower())
    return jsonify(artists)


@bp.get('/music/albums')
def music_albums():
    """アルバム一覧（音楽の series）。sort=title|added|artist|year"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    require_screen('library')
    albums = db.get_music_albums(private_categories=private_cats())
    sort = request.args.get('sort') or 'title'
    if sort == 'added':
        albums.sort(key=lambda a: (a.get('added_at') or ''), reverse=True)
    elif sort == 'artist':
        albums.sort(key=lambda a: ((a.get('artist') or '').lower(), (a.get('name') or '').lower()))
    elif sort == 'year':
        albums.sort(key=lambda a: (a.get('year_at') or ''), reverse=True)
    else:
        albums.sort(key=lambda a: (a.get('name') or '').lower())
    return jsonify(albums)


@bp.get('/music/tracks')
def music_tracks():
    """曲一覧。sort=title|added|artist、?favorite=1 でお気に入りだけ。

    お気に入りかどうかは各カードに favorite を付けて返す（曲タブの★表示用）。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    require_screen('library')
    ids = db.get_music_track_ids(request.args.get('sort') or 'title',
                                 private_categories=private_cats())
    user, users_db = _music_user()
    favs = set(users_db.list_music_favorites(user['id'])) if user else set()
    if request.args.get('favorite') in ('1', 'true'):
        ids = [i for i in ids if i in favs]
    return jsonify(_music_cards(db, ids, {i: {'favorite': i in favs} for i in ids}))


@bp.get('/music/favorites')
def music_favorites():
    """自分のお気に入りの曲の一覧。"""
    user, users_db = _music_user()
    return jsonify(users_db.list_music_favorites(user['id']) if user else [])


@bp.put('/music/favorites/<int:video_id>')
async def add_music_favorite(video_id):
    """曲をお気に入りに足す。"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    users_db.set_music_favorite(user['id'], video_id, True)
    return jsonify({'video_id': video_id, 'favorite': True})


@bp.delete('/music/favorites/<int:video_id>')
def remove_music_favorite(video_id):
    """曲をお気に入りから外す。"""
    user, users_db = _music_user()
    if not user:
        abort(401, description='ログインが必要です')
    users_db.set_music_favorite(user['id'], video_id, False)
    return jsonify({'video_id': video_id, 'favorite': False})


