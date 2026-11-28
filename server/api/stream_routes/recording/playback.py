"""HLS の配信・字幕・コメント"""

import json
from quart import jsonify, request
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _parse_captions_data  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from ..recording_hls import _hls_buffer, _hls_keepalive, _hls_segment  # noqa: F401


@bp.get('/streams/video/<int:rec_id>/<quality>/segment')
async def video_segment(rec_id: int, quality: str):
    """録画番組の HLS セグメント（MPEG-TS）を返す。未エンコードならその位置から生成する。"""
    return await _hls_segment()


@bp.get('/streams/video/<int:rec_id>/<quality>/buffer')
async def video_buffer(rec_id: int, quality: str):
    """録画番組の HLS バッファ範囲を SSE で随時配信する。"""
    return _hls_buffer()


@bp.put('/streams/video/<int:rec_id>/<quality>/keep-alive')
async def video_keepalive(rec_id: int, quality: str):
    """録画番組のストリーミングセッションを維持する（視聴中は定期的に呼ぶ）。"""
    return _hls_keepalive()


@bp.get('/streams/video/<int:rec_id>/captions-data')
def video_captions_data(rec_id: int):
    """録画再生の字幕テキストデータを返す（captions_json → [{pts, duration_ms, text}]）。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        return jsonify({'error': 'recording not found'}), 404
    track = request.args.get('track', '1')
    raw = recording.get('captions2_json') if track == '2' else recording.get('captions_json')
    return jsonify({'captions': _parse_captions_data(raw)})


def _comments_payload(raw):
    """comments_json から弾幕用レスポンスを作る。

    'comments' が主トラック。それ以外のリスト値キー('掲示板のコメント'等の
    任意名)は名前付きの追加トラックとして 'tracks' に載せ、プレイヤーの
    コメントタブで切り替えられるようにする。"""
    if not raw:
        return {'comments': []}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {'comments': []}
    if isinstance(data, list):
        return {'comments': data}
    if not isinstance(data, dict):
        return {'comments': []}
    primary = data.get('comments')
    out = {'comments': primary if isinstance(primary, list) else []}
    extra = {k: v for k, v in data.items() if k != 'comments' and isinstance(v, list)}
    if extra:
        out['tracks'] = extra
    return out


@bp.get('/streams/video/<int:rec_id>/comments')
def video_comments(rec_id: int):
    """録画再生の弾幕用に、録画時取得した実況コメント(comments_json)を返す。
    各コメントの time は録画開始からの秒数。複数トラックは tracks に載る。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        return jsonify({'error': 'recording not found'}), 404
    return jsonify(_comments_payload(recording.get('comments_json')))


