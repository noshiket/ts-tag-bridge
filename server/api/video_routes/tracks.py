"""コメント・追加トラック・告知・実況"""

import json
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _caption3_tracks  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag, _save_tag  # noqa: F401
from .confirmed.tag import _video_tag_path


def _added_tracks_payload(video):
    """後付けトラック（音声比較などで追加したもの）の一覧。

    字幕は captions3_json の各トラック、コメントは comments_json のトップレベルにある
    'comments'（TS/実況由来の主トラック）以外の名前付き list。どちらも後から消せる。
    """
    caps = [{'index': i, 'name': t.get('name') or f'字幕{i + 1}', 'count': len(t.get('captions') or [])}
            for i, t in enumerate(_caption3_tracks(video.get('captions3_json')))]
    try:
        cur = json.loads(video.get('comments_json') or '{}')
    except (json.JSONDecodeError, TypeError):
        cur = {}
    cmts = ([{'key': k, 'count': len(v)} for k, v in cur.items()
             if k != 'comments' and isinstance(v, list)] if isinstance(cur, dict) else [])
    return {'captions': caps, 'comments': cmts}


@bp.get('/videos/<int:video_id>/added-tracks')
def video_added_tracks(video_id):
    """動画に後から足した字幕・実況コメントなどの一覧。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404, description='動画が見つかりません')
    return jsonify(_added_tracks_payload(video))


@bp.get('/videos/<int:video_id>/audio-sync')
def video_audio_sync(video_id):
    """取り込み時に残した時間対応(tag.json の audio_sync)を返す。

    どの放送のどの区間が、どれだけずらして取り込まれたかを画面で確認するためのもの。
    記録が無ければ空リスト。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        abort(404, description='動画が見つかりません')
    try:
        with open(tag_path, encoding='utf-8') as f:
            tag = json.load(f)
    except (OSError, json.JSONDecodeError):
        return jsonify({'records': []})
    rec = tag.get('audio_sync')
    return jsonify({'records': rec if isinstance(rec, list) else []})


@bp.post('/videos/<int:video_id>/added-tracks/delete')
async def video_added_tracks_delete(video_id):
    """後付けトラックを削除する。body: {caption_index?: int, comment_key?: str}"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        abort(404, description='動画が見つかりません')

    body = await _json()
    fields = {}

    idx = body.get('caption_index')
    if idx is not None:
        tracks = _caption3_tracks(video.get('captions3_json'))
        if not (0 <= int(idx) < len(tracks)):
            abort(400, description='その字幕トラックはありません')
        tracks.pop(int(idx))
        fields['captions3_json'] = tracks

    key = body.get('comment_key')
    if key:
        if key == 'comments':
            abort(400, description='主コメントトラックは削除できません')
        try:
            cur = json.loads(video.get('comments_json') or '{}')
        except (json.JSONDecodeError, TypeError):
            cur = {}
        if not isinstance(cur, dict) or not isinstance(cur.get(key), list):
            abort(400, description='そのコメントトラックはありません')
        cur.pop(key)
        fields['comments_json'] = cur

    if not fields:
        abort(400, description='削除する対象が指定されていません')
    _update_video_json_cols(db, video_id, tag_path, fields)
    return jsonify({'deleted': True, **_added_tracks_payload(db.get_video_row(video_id))})


def _update_video_json_cols(db, video_id, tag_path, fields: dict):
    """video の JSON 列を tag.json と DB の両方へ書く（_update_video_announce と同じ規約）。

    tag.json が正で DB はそのスナップショットのため、DB だけ書くと再エンコードや
    relocate の add_videos で上書きされて消える。必ず両方書く。
    fields の値は dict/list を渡す（tag.json には構造のまま、DB には JSON 文字列で入れる）。
    """
    if tag_path:
        tag = _load_tag(tag_path) or {}
        tag.update(fields)
        try:
            _save_tag(tag_path, tag)
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('_update_video_json_cols: tag.json 書込失敗 id=%s: %s', video_id, e)
    db.update_video(video_id, **{
        k: (v if isinstance(v, (str, int)) or v is None else json.dumps(v, ensure_ascii=False))
        for k, v in fields.items()
    })


