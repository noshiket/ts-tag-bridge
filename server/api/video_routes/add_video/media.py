"""サムネ・フレーム・副音声のファイル"""

import asyncio
import json
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
    Response,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.tag_io import _save_tag  # noqa: F401


def _generate_video_thumbnails(db, video_id: int, file_path: str, tag: dict,
                               config: dict = None) -> list:
    """代表サムネとシークバー用タイルを作って video へ登録する（best-effort）。

    config を渡すとアプリコンテキスト外（バックグラウンドのジョブ）からも呼べる。
    """
    try:
        from media.tsukujima.thumbnail_generator import ThumbnailGenerator
        config = config if config is not None else current_app.config['ENCODE_AUTO']
        dur = float(tag.get('duration_sec') or 0)
        if dur <= 0:
            return []
        gen = ThumbnailGenerator.from_encoding(
            file_path, dur, [{'duration_sec': dur}], tag.get('eit_genre') or '',
            config.get('ffmpeg', 'ffmpeg'))
        thumb, tile = gen.generate_and_save()
        fields = {}
        if thumb:
            fields['thumbnail_path'] = thumb
        if tile:
            fields['thumbnail_tile_path'] = tile
            tw, th = gen.TILE_SCALE
            fields['thumbnail_info'] = json.dumps({
                'version': 1,
                'representative': {'format': 'WebP',
                                   'width': gen.SCORING_SCALE[0], 'height': gen.SCORING_SCALE[1]},
                'tile': {'format': 'WebP', 'image_width': gen.tile_image_width,
                         'image_height': gen.tile_image_height, 'tile_width': tw,
                         'tile_height': th, 'total_tiles': gen.total_tiles,
                         'column_count': gen.tile_cols, 'row_count': gen.tile_rows,
                         'interval_sec': gen.tile_interval_sec},
            }, ensure_ascii=False)
        if not fields:
            return []
        tag.update({k: (json.loads(v) if k == 'thumbnail_info' else v) for k, v in fields.items()})
        _save_tag(file_path + '.tag.json', tag)
        db.update_video(video_id, **fields)
        return [k.replace('_path', '') for k in fields if k.endswith('_path')]
    except Exception as e:
        import logging as _lg
        _lg.getLogger(__name__).warning('add_video_manual: サムネ生成に失敗(無視): %s', e)
        return []


@bp.get('/videos/<int:video_id>/frame')
async def video_frame(video_id):
    """指定秒のフレームを1枚返す（コマ送りの静止画表示用）。?t=秒&w=幅

    再生位置を動かすだけでは、HLS 配信だとブラウザが絵を更新しないことがある。
    フレーム表(frame_table)で吸着した時刻をそのまま渡せば、そのコマの絵が返る。
    -ss を入力の手前に置いて近くまで飛び、そこから select で目的の時刻ちょうどの
    フレームを1枚だけ選ぶ（録画TSの frame エンドポイントと同じ考え方）。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    path = video.get('file_path') or ''
    if not path or not os.path.isfile(path):
        abort(404, description='動画ファイルが見つかりません')
    try:
        t = max(0.0, float(request.args.get('t', 0)))
    except ValueError:
        t = 0.0
    try:
        width = max(64, min(int(request.args.get('w', 480)), 1920))
    except ValueError:
        width = 480

    from media.probe import ffprobe as _ffprobe_mod  # noqa: F401
    from media.probe import frame_grab
    cfg = current_app.config['ENCODE_AUTO']
    ffmpeg = cfg.get('ffmpeg', 'ffmpeg')
    pre = max(0.0, t - 2.0)          # 1〜2GOP 手前へ高速移動してからデコードする
    # 時刻は 6 桁で渡し、わずかに手前を狙う。3 桁に丸めると目的のフレームを
    # 通り越して次のフレームが返り、コマ送りしても絵が変わらないことがあった
    # (例: 108.908800 → 108.909 では gte で次のコマが選ばれる)。
    # フレーム間隔は最短でも約8msなので 2ms 手前なら前のコマは拾わない。
    sel = max(0.0, t - 0.002)
    cmd = [ffmpeg, '-nostdin', '-v', 'error', '-copyts', '-ss', f'{pre:.6f}', '-i', path,
           '-vf', f"select='gte(t,{sel:.6f})',scale={width}:-2", '-frames:v', '1',
           *frame_grab.vsync_opts(ffmpeg), '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']

    def _run():
        import subprocess
        return subprocess.run(cmd, capture_output=True, timeout=60).stdout

    data = await asyncio.to_thread(_run)
    if not data:
        abort(404, description='フレームを取得できませんでした')
    return Response(data, content_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=3600'})


@bp.put('/videos/series/<int:series_id>/videos/<int:video_id>/move')
async def move_series_video(series_id, video_id):
    """series内でのvideo表示順(sort_order)を1つ上/下に入れ替える。body: {direction: 'up'|'down'}"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await request.get_json(silent=True) or {}
    direction = body.get('direction')
    if direction not in ('up', 'down'):
        abort(400, description='direction は up/down のいずれかを指定してください')
    moved = db.move_video(series_id, video_id, direction)
    return jsonify({'moved': moved})


def _serve_image_revalidate(path):
    """画像をファイル mtime ベースの ETag 付きで返す。
    Cache-Control: no-cache でブラウザは毎回再検証し、未変更なら 304、
    上書き差し替え時は即座に新しい画像を返す（サムネ差し替えのキャッシュ問題対策）。
    """
    import mimetypes
    mime = mimetypes.guess_type(path)[0] or 'image/jpeg'
    st = os.stat(path)
    etag = f'"{int(st.st_mtime)}-{st.st_size}"'
    if request.headers.get('If-None-Match') == etag:
        return Response(status=304, headers={'ETag': etag, 'Cache-Control': 'no-cache'})
    # ファイルを丸ごとメモリへ読み込まずに送る。長さは上で取った stat の値を使う
    body = current_app.response_class.file_body_class(path)
    resp = Response(body, mimetype=mime,
                    headers={'Cache-Control': 'no-cache', 'ETag': etag})
    resp.content_length = st.st_size
    return resp


