"""Amatsukaze のロゴ解析とトリムの画面（始める・結果の絵とファイル・トリムの保存）"""

from quart import jsonify
from api.routes.auth import bp
from api.routes.media import _amz
from api.routes.caches import _json
from .amz_call import _amz_call


@bp.post('/amatsukaze/logo/analyze')
async def amz_start_logo_analyze():
    """キューの項目の映像からロゴの解析を始める（ロゴファイルを作る）。

    body: {queueItemId, x?, y?, width?, height?, threshold?, maxFrames?}。進み具合は GET /api/amatsukaze/logo/analyze/<job_id>。
    """
    body = await _json()
    result = _amz_call(
        _amz().start_logo_analyze,
        body['queueItemId'],
        x=body.get('x', 10),
        y=body.get('y', 10),
        width=body.get('width', 72),
        height=body.get('height', 36),
        threshold=body.get('threshold', 30),
        max_frames=body.get('maxFrames', 1000),
    )
    return jsonify(result)


@bp.get('/amatsukaze/logo/analyze/<job_id>/image')
def amz_logo_analyze_image(job_id):
    """ロゴの解析でできたロゴの画像（JPEG）。"""
    from quart import Response
    data = _amz_call(_amz().get_logo_analyze_image, job_id)
    return Response(data, content_type='image/jpeg')


@bp.get('/amatsukaze/logo/analyze/<job_id>/file')
def amz_logo_analyze_file(job_id):
    """ロゴの解析でできたロゴファイル（.lgd）。"""
    from quart import Response
    data = _amz_call(_amz().get_logo_analyze_file, job_id)
    return Response(data, content_type='application/octet-stream')


@bp.post('/amatsukaze/logo/preview/sessions')
async def amz_create_logo_preview_session():
    """キューの項目の映像に局のロゴを重ねて見るための準備をする。body: {queueItemId, serviceId}。"""
    body = await _json()
    result = _amz_call(
        _amz().create_logo_preview_session,
        body['queueItemId'],
        body['serviceId'],
    )
    return jsonify(result)


@bp.post('/amatsukaze/trim/sessions')
async def amz_create_trim_session():
    """キューの項目の映像で、残す区間（トリム）を手で決めるための準備をする。body: {queueItemId, scaleMode?}。"""
    body = await _json()
    result = _amz_call(
        _amz().create_trim_session,
        body['queueItemId'],
        scale_mode=body.get('scaleMode', 0),
    )
    return jsonify(result)


@bp.get('/amatsukaze/trim/sessions/<session_id>/bundle/<int:frame>')
def amz_trim_bundle(session_id, frame):
    """トリムの編集で、指定のコマの映像と音声の波形を返す（どちらも JPEG を base64 で）。"""
    import base64
    video_jpg, waveform_jpg = _amz_call(_amz().get_trim_bundle, session_id, frame)
    return jsonify({
        'video': base64.b64encode(video_jpg).decode(),
        'waveform': base64.b64encode(waveform_jpg).decode(),
    })


@bp.post('/amatsukaze/trim/sessions/<session_id>/save')
async def amz_save_trims(session_id):
    """トリムの編集で決めた残す区間を保存する。body: {trims}。"""
    body = await _json()
    result = _amz_call(_amz().save_trims, session_id, body['trims'])
    return jsonify(result)
