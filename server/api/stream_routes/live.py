"""ライブ視聴（/api/streams/live/*, /channels）"""

import asyncio
import json
from quart import jsonify, Response
from api.routes.auth import bp  # noqa: F401
from .live_open import _open_live  # noqa: F401


def _pts_gaps_of(drop_error) -> list:
    """drop_error から pts_gaps(受信断の区間)だけ取り出す。無ければ空。

    プレイヤーが TOT⇔再生位置を変換する際に引くために配る。drop_error 全体は
    errors が数千件になることがあるので、必要な区間だけに絞って渡す。
    """
    if not drop_error:
        return []
    try:
        if isinstance(drop_error, str):
            drop_error = json.loads(drop_error)
        return [g for g in (drop_error.get('pts_gaps') or [])
                if g.get('start_tot') and isinstance(g.get('lost_sec'), (int, float))]
    except (json.JSONDecodeError, TypeError, AttributeError):
        return []


# ============================================================================
# ライブストリーミング API
# ============================================================================

@bp.get('/streams')
async def get_streams():
    """全アクティブストリームの一覧を返す"""
    from media.tsukujima.live_stream import LiveStream
    streams = []
    for ls in LiveStream.getAllLiveStreams():
        status = ls.getStatus()
        if status.status == 'Offline':
            continue
        streams.append({
            'live_stream_id': ls.live_stream_id,
            'display_channel_id': ls.display_channel_id,
            'quality': ls.quality,
            'status': status.status,
            'detail': status.detail,
            'started_at': status.started_at,
            'updated_at': status.updated_at,
            'client_count': status.client_count,
        })
    return jsonify(streams)


@bp.get('/streams/channels')
async def get_stream_channels():
    """ストリーミング可能なチャンネル一覧を返す"""
    from media.tsukujima.live_stream import LiveStream
    # getChannelList は空のとき EDCB へ同期(blocking)再取得し得るため、
    # イベントループを塞がないようスレッドで実行する
    channels = await asyncio.to_thread(LiveStream.getChannelList)
    # 見てよい局だけ（局の許可と、有料の局。開く口は record_guard でも断る）
    from api.routes.auth import perm
    return jsonify(perm().filter_items(
        channels, get_service=lambda c: (c['network_id'], c['transport_stream_id'], c['service_id'])))


@bp.get('/streams/live/<display_channel_id>/<quality>/mpegts')
async def live_stream_mpegts(display_channel_id: str, quality: str):
    """ライブストリーム MPEG-TS 配信"""
    live_stream, err = _open_live(display_channel_id, quality)
    if err:
        return err
    client = await live_stream.connect('mpegts')

    async def generate():
        try:
            while True:
                # Offline ならストリーム終了
                if live_stream.getStatus().status == 'Offline':
                    break
                stream_data = await client.readStreamData()
                if stream_data is not None:
                    yield stream_data
                else:
                    # None = エンコードタスク終了
                    break
        finally:
            live_stream.disconnect(client)

    return Response(
        generate(),
        mimetype='video/mp2t',
        headers={
            'Cache-Control': 'no-cache, no-store',
            'X-Accel-Buffering': 'no',
        },
    )


@bp.get('/streams/live/<display_channel_id>/<quality>/events')
async def live_stream_events(display_channel_id: str, quality: str):
    """ライブストリーム SSE ステータス通知"""
    from media.tsukujima.live_stream import LiveStream
    live_stream, err = _open_live(display_channel_id, quality)
    if err:
        return err

    async def generate():
        previous_status = None
        while True:
            status = live_stream.getStatus()
            client_count = LiveStream.getViewerCount(display_channel_id)
            status_dict = {
                'status': status.status,
                'detail': status.detail,
                'started_at': status.started_at,
                'updated_at': status.updated_at,
                'client_count': client_count,
            }
            if status_dict != previous_status:
                yield f'data: {json.dumps(status_dict, ensure_ascii=False)}\n\n'
                previous_status = status_dict
                # Offline になったら SSE 終了
                if status.status == 'Offline':
                    break
            await asyncio.sleep(0.1)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache'},
    )


@bp.get('/streams/live/<display_channel_id>/<quality>/psi-archived-data')
async def live_stream_psi(display_channel_id: str, quality: str):
    """PSI/SI データ放送アーカイブストリーム"""
    live_stream, err = _open_live(display_channel_id, quality)
    if err:
        return err

    if live_stream.psi_data_archiver is None:
        return jsonify({'error': 'PSI data archiver is not available. Stream may not be active.'}), 503

    return Response(
        live_stream.psi_data_archiver.getPSIArchivedData(),
        mimetype='application/octet-stream',
        headers={'Cache-Control': 'no-cache'},
    )


