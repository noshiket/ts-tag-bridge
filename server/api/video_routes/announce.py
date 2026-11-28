"""放送の異常の告知（読む・取り直す・直す）"""

from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.tag_io import _load_tag, _save_tag
from .confirmed.tag import _video_tag_path


def _update_video_announce(db, video_id, tag_path, v, value):
    """video の announce を tag.json と DB カラムの両方へ書く。"""
    if tag_path:
        tag = _load_tag(tag_path) or {}
        tag['announce'] = value
        try:
            _save_tag(tag_path, tag)
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('_update_video_announce: tag.json 書込失敗 id=%s: %s', video_id, e)
    db.update_video(video_id, announce=value)


@bp.post('/videos/<int:video_id>/fetch_announce')
def fetch_video_announce(video_id):
    """しょぼいカレンダーから放送異常告知(テロップ等)を再取得し tag.json + video.announce を更新する。
    sid + eit_start_time で照合。取得できない場合は announce を変更せず取得値 None を返す。"""
    from logic.encode_pipeline.step_file_copy import fetch_announce_by_sid
    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    value = fetch_announce_by_sid(v.get('sid'), v.get('eit_start_time'))
    if value:
        _update_video_announce(db, video_id, tag_path, v, value)
    return jsonify({'id': video_id, 'announce': value, 'fetched': bool(value)})


@bp.patch('/videos/<int:video_id>/announce')
async def set_video_announce(video_id):
    """テロップ有無を手動で設定する。value(文字列)を tag.json + video.announce へ保存。
    有=「テロップ(手動)」/ 無=「none(手動)」を想定(none 始まり=なし判定)。"""
    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    body = await _json()
    value = body.get('value')
    if not isinstance(value, str):
        abort(400, description='value(文字列)が必要です')
    _update_video_announce(db, video_id, tag_path, v, value)
    return jsonify({'id': video_id, 'announce': value})
