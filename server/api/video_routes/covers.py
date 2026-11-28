"""ジャケット（動画・シリーズ・アルバム。隣の画像か新しい物）"""

import os
from quart import current_app, request, abort
from api.routes.auth import bp
from api.routes.tag_io import _load_tag
from .library.deletion import _SIDE_SUFFIXES
from .add_video.media import _serve_image_revalidate
from .confirmed.tag import _video_tag_path
from .thumbnails import get_album_thumbnail, get_series_thumbnail, get_video_thumbnail


@bp.get('/videos/<int:video_id>/cover')
def get_video_cover(video_id):
    """音楽のジャケット原本を返す。無ければ 404（呼び出し側は thumbnail へ落とす）。

    thumbnail は再生用MP4から作った 16:9（中央にジャケット、左右はぼかし）なので、
    ロック画面などに出すと加工した絵になる。原寸の正方形はこの .cover.* にしか無い。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        abort(404)
    cover = ((_load_tag(tag_path) or {}).get('cover_path') or '') if tag_path else ''
    if not (cover and os.path.exists(cover)):
        cover = _cover_beside(video.get('file_path') or '')
    if not cover:
        # ?fallback=1: 一覧の画像用。原本が無ければサムネで代わりに出す
        if request.args.get('fallback'):
            return get_video_thumbnail(video_id)
        abort(404)
    return _serve_image_revalidate(cover)


def _cover_beside(file_path: str) -> str:
    """動画の隣にあるジャケット原本(<stem>.cover.*)。無ければ空。"""
    stem = os.path.splitext(file_path)[0]
    if not stem:
        return ''
    return next((stem + suf for suf in _SIDE_SUFFIXES
                 if suf.startswith('.cover.') and os.path.exists(stem + suf)), '')


def _newest_cover(paths) -> str:
    return next((c for c in map(_cover_beside, paths) if c), '')


@bp.get('/videos/series/<int:series_id>/cover')
def get_series_cover(series_id):
    """series(ミュージックではアルバム)のジャケット原本。新しい曲から探し、どの曲にも無ければ
    サムネイルを返す。タイルを正方形に切り抜いて出すため（サムネは 16:9 で左右がぼかし）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    cover = _newest_cover(db.get_video_paths_newest_first(series_id=series_id))
    return _serve_image_revalidate(cover) if cover else get_series_thumbnail(series_id)


@bp.get('/videos/albums/<int:album_id>/cover')
def get_album_cover(album_id):
    """album(ミュージックではアーティスト)のジャケット原本。考え方は series と同じ。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    cover = _newest_cover(db.get_video_paths_newest_first(album_id=album_id))
    return _serve_image_revalidate(cover) if cover else get_album_thumbnail(album_id)
