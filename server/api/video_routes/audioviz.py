"""音の波形（音楽の再生画面）"""

import asyncio
import os
from quart import current_app, abort, send_file
from api.routes.auth import bp
from logic.encoding import load_weights


@bp.get('/videos/<int:video_id>/audioviz')
async def video_audioviz(video_id):
    """再生画面の波形/スペクトラム用のデータ（音楽のみ）。

    再生中に Web Audio で解析すると音声が AudioContext 経由になり、iOS が背景で
    それを止めるため PiP にしたまま画面を消して聴けなくなる。音の通り道には触らず、
    先に解析した数値を再生位置に合わせて描くだけにする。
    取り込み時に作るが、その仕組みより前の曲はここで作って隣に置く（1曲2秒ほど）。
    """
    from media import audio_viz

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None or (video.get('media_kind') or '') != 'audio':
        abort(404)
    path = video.get('file_path') or ''
    if not path or not os.path.exists(path):
        abort(404, description='ファイルが見つかりません')
    out = audio_viz.viz_path(path)
    if not audio_viz.is_current(out):     # 未生成、または古い版なら作り直す
        cfg = current_app.config['ENCODE_AUTO']
        try:
            await asyncio.to_thread(audio_viz.build, cfg.get('ffmpeg', 'ffmpeg'), path,
                                    load_weights.audio_sync_params(cfg)['nice'])
        except Exception as e:
            abort(500, description=f'波形データを作れませんでした: {e}')
    response = await send_file(out, mimetype='application/octet-stream', conditional=True)
    response.headers['Cache-Control'] = 'private, max-age=86400'   # 曲ごとに不変
    return response
