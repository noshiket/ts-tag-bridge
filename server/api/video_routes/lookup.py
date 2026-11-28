"""放送からの検索とカード（/api/videos/find_by_broadcast, /cards）"""

from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp, private_cats  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from .library.perms import _perm_visible_videos  # noqa: F401


@bp.get('/videos/cards')
def get_video_cards():
    """複数idのvideoをカード表示用の形で返す(?ids=1,2,3)。
    ローカル保存/続きを見る一覧をライブラリと同じVideoRowカードで描画するために使う。"""
    video_db = current_app.config.get('VIDEO_DB')
    if video_db is None:
        return jsonify([])
    try:
        ids = [int(x) for x in (request.args.get('ids') or '').split(',') if x.strip()]
    except ValueError:
        abort(400, description='ids が不正です')
    return jsonify(_perm_visible_videos(video_db.get_video_cards(ids[:200], private_categories=private_cats())))


@bp.patch('/videos/<int:video_id>/allow_duplicate')
async def patch_video_allow_duplicate(video_id):
    """重複録画の許可フラグを切り替える(videoカードの「…」のトグル)。

    許可(1)にすると、この動画と解析値が一致する予約は auto_skip_duplicates 設定でも
    自動スキップされない(撮り直し歓迎)。drop/scramble のある動画は登録時に自動で許可。
    body: {allow: bool}
    """
    video_db = current_app.config.get('VIDEO_DB')
    if video_db is None:
        abort(500, description='video.db が利用できません')
    body = await _json()
    allow = bool(body.get('allow'))
    if video_db.get_video_row(video_id) is None:
        abort(404, description='video が見つかりません')
    video_db.set_allow_duplicate(video_id, allow)
    return jsonify({'id': video_id, 'allow_duplicate': 1 if allow else 0})
