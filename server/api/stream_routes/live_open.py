"""ライブを開く（局と画質から LiveStream を用意する）"""

from quart import jsonify


def _open_live(display_channel_id: str, quality: str):
    """画質と局を確かめて LiveStream を返す。(live_stream, None) か、だめなら (None, エラーの応答)。"""
    from media.tsukujima.live_stream import LiveStream
    from media.tsukujima.quality import QUALITY

    if quality not in QUALITY:
        return None, (jsonify({'error': f'Invalid quality: {quality}'}), 400)
    if LiveStream.resolve_channel(display_channel_id) is None:
        return None, (jsonify({'error': f'Channel not found: {display_channel_id}'}), 404)
    return LiveStream(display_channel_id, quality), None
