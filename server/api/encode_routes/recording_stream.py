"""録画の TS をそのまま流す・HLS の目次と区切り"""

import os
import subprocess
from quart import current_app, request, abort, Response
from api.routes.auth import bp
from api.routes.parser import _ruledb


def _stream_stdout(cmd):
    """cmd を起動し、標準出力を 64KB ずつ流す。送り終えたら（切断されても）止める。"""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            yield chunk
    finally:
        proc.kill()
        proc.wait()


@bp.get('/encode/recordings/<int:rec_id>/video_stream')
def video_stream_recording(rec_id):
    """ffmpeg で 240p fragmented MP4 にトランスコードしてストリーミング。
    -g 1 でフレーム精度シーク対応。t パラメータで開始秒を指定できる。
    """
    from quart import Response, request as _req
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    try:
        t = float(_req.args.get('t', 0.0))
    except ValueError:
        t = 0.0
    config = current_app.config['ENCODE_AUTO']
    ffmpeg = config.get('ffmpeg', 'ffmpeg')
    cmd = [
        ffmpeg, '-y',
        '-ss', str(t),
        '-i', ts_path,
        '-vf', 'scale=-2:240',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-g', '1',
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1',
    ]

    return Response(_stream_stdout(cmd), content_type='video/mp4',
                    headers={'Cache-Control': 'no-cache, no-store'})


@bp.get('/encode/recordings/<int:rec_id>/hls/manifest.m3u8')
def hls_manifest(rec_id):
    """Safari / クロスブラウザ対応: 仮想 HLS マニフェスト生成。
    ?t=<開始秒>&dur=<長さ秒> を受け取り、4秒セグメントの VOD m3u8 を返す。
    """
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    ts_path = (recording.get('app_ts_path') or recording.get('host_ts_path')
               or recording.get('edcb_ts_path', ''))
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    try:
        t = float(request.args.get('t', 0.0))
    except (ValueError, TypeError):
        t = 0.0
    try:
        dur = min(float(request.args.get('dur', 300.0)), 3600.0)
    except (ValueError, TypeError):
        dur = 300.0

    seg_len = 4  # seconds per segment
    # 相対パスにする(絶対パスだとfederationのnode_proxy(/api/nodes/<name>/...)経由で
    # 取得した際に自ノードのrec_idを指してしまい壊れる。相対ならマニフェストと同じ
    # ディレクトリに解決されるため、直接アクセス/プロキシ経由のどちらでも正しく動く)。
    base = 'seg.ts'
    lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        f'#EXT-X-TARGETDURATION:{seg_len}',
        '#EXT-X-MEDIA-SEQUENCE:0',
    ]
    offset = 0.0
    while offset < dur:
        actual = min(seg_len, dur - offset)
        lines.append(f'#EXTINF:{actual:.3f},')
        lines.append(f'{base}?t={t + offset:.3f}&len={seg_len}')
        offset += seg_len
    lines.append('#EXT-X-ENDLIST')
    return Response('\n'.join(lines) + '\n',
                    content_type='application/x-mpegURL',
                    headers={'Cache-Control': 'no-cache, no-store'})


@bp.get('/encode/recordings/<int:rec_id>/hls/seg.ts')
def hls_segment_ts(rec_id):
    """HLS セグメント (MPEG-TS) をオンデマンドで ffmpeg 生成してストリーム。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    ts_path = (recording.get('app_ts_path') or recording.get('host_ts_path')
               or recording.get('edcb_ts_path', ''))
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    try:
        t = float(request.args.get('t', 0.0))
    except (ValueError, TypeError):
        t = 0.0
    try:
        seg_len = float(request.args.get('len', 4.0))
    except (ValueError, TypeError):
        seg_len = 4.0

    config = current_app.config['ENCODE_AUTO']
    ffmpeg = config.get('ffmpeg', 'ffmpeg')
    cmd = [
        ffmpeg, '-y',
        '-ss', str(t),
        '-i', ts_path,
        '-t', str(seg_len),
        '-vf', 'scale=iw*sar:ih,scale=-2:240',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-bf', '0',
        '-c:a', 'aac', '-b:a', '64k',
        '-f', 'mpegts',
        'pipe:1',
    ]

    return Response(_stream_stdout(cmd), content_type='video/mp2t',
                    headers={'Cache-Control': 'public, max-age=3600'})
