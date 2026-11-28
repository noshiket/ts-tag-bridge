"""録画の HLS（目次・区切り・先読み・つなぎ止め）"""

import asyncio
import json
from quart import jsonify, request, Response
from api.routes.auth import bp
from .recording_source import _build_video_source, _streaming_encoder


def _hls_playlist(build_source, source_id: int, quality: str, not_found: str):
    """仮想 HLS M3U8 プレイリストを返す（セグメントは随時エンコード）。

    build_source(id) -> (src, row)。src が None なら 404。
    """
    from media.tsukujima.video_stream import VideoStream
    from media.tsukujima.stream_encoding_options import SplitQualityAndEncodingOptions
    from media.tsukujima.quality import AUDIO_ONLY_BASE_QUALITY, AUDIO_ONLY_QUALITY

    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'session_id is required'}), 400
    encoder = _streaming_encoder()
    # 音声のみは映像の画質を持たない。セグメントの組み立て用に別の画質を借りる
    audio_only = quality == AUDIO_ONLY_QUALITY
    sq = SplitQualityAndEncodingOptions(AUDIO_ONLY_BASE_QUALITY if audio_only else quality, encoder)
    if sq is None:
        return jsonify({'error': f'Invalid quality: {quality}'}), 422

    src, _row = build_source(source_id)
    if src is None:
        return jsonify({'error': not_found}), 404

    secondary_audio = request.args.get('audio') == 'secondary'
    vs = VideoStream(session_id, src, sq.quality, sq.encoding_options,
                     encoder=encoder, secondary_audio=secondary_audio, is_new_session_allowed=True,
                     audio_only=audio_only)
    playlist = vs.getVirtualPlaylist(request.args.get('cache_key'))
    return Response(playlist, mimetype='application/vnd.apple.mpegurl',
                    headers={'Cache-Control': 'max-age=0'})


async def _hls_segment():
    """HLS セグメント（MPEG-TS）を返す。未エンコードならその位置から生成する。"""
    from media.tsukujima.video_stream import VideoStream

    session_id = request.args.get('session_id')
    sequence = request.args.get('sequence')
    if not session_id or sequence is None:
        return jsonify({'error': 'session_id and sequence are required'}), 400

    vs = VideoStream.get(session_id)
    if vs is None:
        return jsonify({'error': 'Session does not exist'}), 422

    try:
        data = await vs.getSegment(int(sequence))
    except ValueError:
        return jsonify({'error': 'invalid sequence'}), 400
    if data is None:
        return jsonify({'error': 'Specified sequence segment was not found'}), 422
    return Response(data, mimetype='video/mp2t',
                    headers={'Cache-Control': 'max-age=10800'})


def _hls_buffer():
    """HLS バッファ範囲を SSE で随時配信する。"""
    from media.tsukujima.video_stream import VideoStream

    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'session_id is required'}), 400
    if VideoStream.get(session_id) is None:
        return jsonify({'error': 'Session does not exist'}), 422

    async def generate():
        previous = None
        while True:
            vs = VideoStream.get(session_id)
            if vs is None:
                break  # セッション終了で SSE を閉じる
            buffer_range = vs.getBufferRange()
            if buffer_range != previous:
                previous = buffer_range
                payload = json.dumps({'begin': buffer_range[0], 'end': buffer_range[1]})
                yield f'event: buffer_range_update\ndata: {payload}\n\n'
            await asyncio.sleep(0.1)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no'})


def _hls_keepalive():
    """ストリーミングセッションを維持する（視聴中は定期的に呼ぶ）。"""
    from media.tsukujima.video_stream import VideoStream

    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'session_id is required'}), 400
    vs = VideoStream.get(session_id)
    if vs is not None:
        vs.keepAlive()
    return '', 204


@bp.get('/streams/video/<int:rec_id>/<quality>/playlist')
async def video_playlist(rec_id: int, quality: str):
    """録画番組の仮想 HLS M3U8 プレイリストを返す（セグメントは随時エンコード）。"""
    return _hls_playlist(_build_video_source, rec_id, quality,
                         'recording not found or TS unavailable')
