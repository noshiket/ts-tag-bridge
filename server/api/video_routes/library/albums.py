"""見える動画の絞り込み・削除・ライブラリ・アルバム"""

import time
from datetime import datetime, timedelta
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp, perm, private_cats, require_screen  # noqa: F401
from api.routes.albums_cache import _albums_cache, _albums_cache_lock, _get_albums_cached  # noqa: F401
from api.routes.edcb_call import _call, _client  # noqa: F401
from .perms import _perm_visible_videos, _perm_prune_videos
from logic.library.new_episodes import new_episode_albums


# ---------------------------------------------------------------------------
# EPG
# ---------------------------------------------------------------------------

@bp.get('/content_types')
def get_content_types():
    """ARIB ジャンル一覧（content_list に渡す content_nibble 値の参照用）。
    content_nibble = nibble1 * 256 + nibble2。
    nibble2=255 は大ジャンル全体にマッチする特殊値（例: アニメ全般 = 7*256+255=1791）。
    """
    from read_tsprogram.constants import ARIB_GENRE_LARGE, ARIB_GENRE_MIDDLE
    result = []
    for n1, genre_name in sorted(ARIB_GENRE_LARGE.items()):
        # 大ジャンル全体（nibble2=0xFF）
        result.append({
            'content_nibble': n1 * 256 + 0xFF,
            'genre':          genre_name,
            'sub_genre':      None,
        })
        # 中分類
        for n2, sub_name in sorted((ARIB_GENRE_MIDDLE.get(n1) or {}).items()):
            result.append({
                'content_nibble': n1 * 256 + n2,
                'genre':          genre_name,
                'sub_genre':      sub_name,
            })
    return jsonify(result)


# ---------------------------------------------------------------------------
# ライブラリ
# ---------------------------------------------------------------------------

@bp.get('/library')
def get_library():
    """録画ファイルブラウザ。?dir=<dir_hash> でサブディレクトリ"""
    dir_hash  = request.args.get('dir')
    file_hash = request.args.get('file')
    result = _call(_client().get_library, dir_hash=dir_hash, file_hash=file_hash)
    return jsonify(result)


def _get_video_album_map_cached(db) -> dict:
    """{video_id: album_id} を data_version 単位でキャッシュする。

    アルバム一覧に「最後に見た日」を付けるために毎回引いていたが、動画1万件超だと
    毎回 0.1秒ほどかかる。中身が変わらない限り作り直す必要はない。
    """
    ver = db.data_version()
    with _albums_cache_lock:
        got = _albums_cache.get(('__video_album_map__', ver))
        if got is not None:
            return got['data']
    data = db.get_video_album_map()
    with _albums_cache_lock:
        _albums_cache[('__video_album_map__', ver)] = {'ts': time.time(), 'data': data}
    return data


@bp.get('/videos/albums')
def get_video_albums():
    """video.db の album 一覧（最新 video 登録順）。ログイン中は latest_watch_at
    （このユーザーの album 内動画の最終視聴日時。視聴順ソート用）と has_new_episode（新着）も付与する。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    require_screen('library')
    t0 = time.time()
    dir_roots = (current_app.config['ENCODE_AUTO'].get('encode_dir_list') or [])
    p = perm()
    # 共有キャッシュは全件のものなので、制限のある利用者はキャッシュを使わず取り直す
    # 音楽はミュージックタブへ分けたので、ここでは動画だけ返す（?media_kind=audio で音楽）
    kind = request.args.get('media_kind') or 'video'
    albums = (db.get_albums(dir_roots, p.video_conds(), private_categories=private_cats(),
                            media_kind=kind)
              if p.limits_videos
              else _get_albums_cached(db, dir_roots, private_cats(), kind))
    t_list = time.time()
    from api.auth_routes.auth import current_user
    user = current_user()
    if user:
        users_db = current_app.config.get('USERS_DB')
        if users_db:
            video_watch = users_db.get_video_watch_map(user['id'])  # {video_id: updated_at}
            video_album = _get_video_album_map_cached(db)            # {video_id: album_id}
            latest_watch = {}
            for vid, updated_at in video_watch.items():
                album_id = video_album.get(vid)
                if album_id is None:
                    continue
                if album_id not in latest_watch or updated_at > latest_watch[album_id]:
                    latest_watch[album_id] = updated_at
            # _get_albums_cached() は全ユーザー共有のキャッシュを返すため、直接書き換えると
            # 別ユーザーの視聴履歴が混ざってしまう。必ずコピーしてから付与する。
            mylist = set(users_db.list_mylist(user['id']))
            # 新着: 前の話を見終えた後に次の話が追加され、まだ見ていない（見たことのあるアルバムだけ調べる）
            fresh = new_episode_albums(db.get_episode_rows(latest_watch.keys()),
                                       users_db.get_video_watch_state(user['id']), users_db.WATCH_COMPLETE_RATIO)
            albums = [{**a, 'latest_watch_at': latest_watch.get(a['id']),
                       'in_mylist': a['id'] in mylist, 'has_new_episode': a['id'] in fresh} for a in albums]
    # 遅くなった時に「一覧の生成」と「視聴履歴の付与」のどちらが重いか分かるよう残す
    # （実測では一覧 0.1s / 付与 0.03s。これを大きく超えるならサーバー側が原因）
    current_app.logger.debug('[albums timing] total=%.2fs list=%.2fs watch=%.2fs n=%d kind=%s',
                            time.time() - t0, t_list - t0, time.time() - t_list, len(albums), kind)
    return jsonify(albums)


@bp.get('/videos/albums/<int:album_id>')
def get_video_album_detail(album_id):
    """video.db の album 詳細（配下 series・videos）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    detail = db.get_album_detail(album_id, private_categories=private_cats())
    if detail is None:
        abort(404)
    return jsonify(_perm_prune_videos(detail))


@bp.get('/videos/albums/<int:album_id>/captures')
def get_video_album_captures(album_id):
    """album内の全videoに紐づくキャプチャ一覧。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    from api.stream_routes.capture_owner import visible
    return jsonify([c for c in db.get_captures_for_album(album_id) if visible(c.get('owner'))])


@bp.get('/videos/series/<int:series_id>/videos')
def get_series_videos_endpoint(series_id):
    """series単体の情報＋配下video一覧（プレイヤー右パネルの「シリーズ」タブ用）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    result = db.get_series_videos(series_id, private_categories=private_cats())
    if result is None:
        abort(404)
    return jsonify(_perm_prune_videos(result))


@bp.get('/videos/momentum')
def get_video_momentum():
    """コメント勢い(コメント数/分)が大きい順の動画一覧(album横断)。
    period=week|month|year で放送日(recording_start_time)の対象期間を絞る。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    period = request.args.get('period', 'week')
    days = {'week': 7, 'month': 30, 'year': 365}.get(period, 7)
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    page = request.args.get('page', default=0, type=int)
    per_page = request.args.get('per_page', default=20, type=int)
    result = db.get_videos_by_momentum(cutoff, page=page, per_page=per_page,
                                       private_categories=private_cats())
    if isinstance(result, dict) and isinstance(result.get('items'), list):
        result['items'] = _perm_visible_videos(result['items'])
    return jsonify(result)
