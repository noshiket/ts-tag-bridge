"""ライブの HLS（iOS の小窓用。目次・区切り・字幕と弾幕・止める）"""

import asyncio
from quart import jsonify, request, Response
from api.routes.auth import bp
from .live_open import _open_live


@bp.get('/streams/live/<display_channel_id>/<quality>/hls/playlist.m3u8')
async def live_hls_playlist(display_channel_id: str, quality: str):
    """ライブの HLS（iOS アプリの小窓 PiP 用）。区切りが3つ揃うまで待ってから返す"""
    from media.tsukujima.live_hls import LiveHLS
    _, err = _open_live(display_channel_id, quality)
    if err:
        return err
    hls = LiveHLS.get(display_channel_id, quality)
    deadline = asyncio.get_running_loop().time() + 25
    while True:
        text = hls.playlist()
        if text is not None or hls.stopped or asyncio.get_running_loop().time() > deadline:
            break
        hls.touch()  # 待っている間に止められないように
        await asyncio.sleep(0.25)
    if text is None:
        return jsonify({'error': hls.error or '配信の準備ができていません'}), 503
    return Response(text, mimetype='application/vnd.apple.mpegurl', headers={'Cache-Control': 'no-cache, no-store'})


@bp.get('/streams/live/<display_channel_id>/<quality>/hls/segment.ts')
async def live_hls_segment(display_channel_id: str, quality: str):
    """ライブの HLS の区切り（TS）を1つ返す。?seq= で番号を指定する（プレイリストに載っている URL）。"""
    from media.tsukujima.live_hls import LiveHLS
    hls = LiveHLS.find(display_channel_id, quality)
    data = hls.segment(request.args.get('seq', -1, type=int)) if hls else None
    if data is None:
        return jsonify({'error': 'segment not found'}), 404
    hls.touch()
    return Response(data, mimetype='video/mp2t', headers={'Cache-Control': 'no-cache'})


@bp.get('/streams/live/<display_channel_id>/<quality>/hls/overlays')
async def live_hls_overlays(display_channel_id: str, quality: str):
    """小窓に焼き込む字幕・実況コメント（時刻は UNIX 秒。since より後の分）。取りに来る間は配信を止めない"""
    from media.tsukujima.live_hls import LiveHLS
    _, err = _open_live(display_channel_id, quality)
    if err:
        return err
    hls = LiveHLS.get(display_channel_id, quality)
    return jsonify(hls.overlays(request.args.get('since', 0.0, type=float)))


@bp.delete('/streams/live/<display_channel_id>/<quality>/hls')
async def live_hls_stop(display_channel_id: str, quality: str):
    """視聴をやめた時に止める（チューナーを早く他へ回せるように）"""
    from media.tsukujima.live_hls import LiveHLS
    hls = LiveHLS.find(display_channel_id, quality)
    if hls:
        hls.stop('（アプリが閉じた）')
    return jsonify({'ok': True})
