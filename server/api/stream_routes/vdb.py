"""ライブラリの動画の再生（/api/streams/vdb/*）"""

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
from api.routes.media import _caption3_tracks, _parse_captions_data  # noqa: F401
from api.routes.tag_io import _load_tag  # noqa: F401
from .recording_hls import _hls_buffer, _hls_keepalive, _hls_playlist, _hls_segment  # noqa: F401
from .recording.drops import _build_drops_payload  # noqa: F401
from .recording.metadata import _build_video_source_from_vdb  # noqa: F401
from .recording.playback import _comments_payload  # noqa: F401


@bp.get('/streams/vdb/<int:video_id>/<quality>/playlist')
async def vdb_playlist(video_id: int, quality: str):
    """video.db 動画の仮想 HLS M3U8 プレイリストを返す。"""
    return _hls_playlist(_build_video_source_from_vdb, video_id, quality,
                         'video not found or file unavailable')


@bp.get('/streams/vdb/<int:video_id>/<quality>/segment')
async def vdb_segment(video_id: int, quality: str):
    """video.db 動画の HLS セグメントを返す。"""
    return await _hls_segment()


@bp.get('/streams/vdb/<int:video_id>/<quality>/buffer')
async def vdb_buffer(video_id: int, quality: str):
    """video.db 動画の HLS バッファ範囲を SSE で配信する。"""
    return _hls_buffer()


@bp.put('/streams/vdb/<int:video_id>/<quality>/keep-alive')
async def vdb_keepalive(video_id: int, quality: str):
    """video.db 動画のストリーミングセッションを維持する。"""
    return _hls_keepalive()


@bp.get('/streams/vdb/<int:video_id>/thumbnail-tile')
def vdb_thumbnail_tile(video_id: int):
    """video.db 動画のシークバー用サムネイルタイルを返す。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    tile_path = video.get('thumbnail_tile_path')
    if tile_path and os.path.exists(tile_path):
        with open(tile_path, 'rb') as f:
            return Response(f.read(), mimetype='image/webp',
                            headers={'Cache-Control': 'max-age=86400'})
    abort(404)


@bp.get('/streams/vdb/<int:video_id>/captions-data')
def vdb_captions_data(video_id: int):
    """video.db 動画の字幕テキストデータを返す（captions_json → [{pts, duration_ms, text}]）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        return jsonify({'error': 'video not found'}), 404
    # track: '1'=字幕 / '2'=文字スーパー / '3:<index>'=後付け字幕(captions3_json)
    track = request.args.get('track', '1')
    if track.startswith('3:'):
        tracks = _caption3_tracks(video.get('captions3_json'))
        try:
            idx = int(track.split(':', 1)[1])
        except ValueError:
            idx = -1
        if not (0 <= idx < len(tracks)):
            return jsonify({'captions': []})
        return jsonify({'captions': _parse_captions_data({'captions': tracks[idx]['captions']})})
    raw = video.get('captions2_json') if track == '2' else video.get('captions_json')
    return jsonify({'captions': _parse_captions_data(raw)})


@bp.get('/streams/vdb/<int:video_id>/comments')
def vdb_comments(video_id: int):
    """video.db 動画の弾幕用コメントを返す。複数トラックは tracks に載る。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        return jsonify({'error': 'video not found'}), 404
    return jsonify(_comments_payload(video.get('comments_json')))


@bp.get('/streams/vdb/<int:video_id>/drops')
def vdb_drops(video_id: int):
    """video.db 動画のドロップ/スクランブル/チャプター位置を返す。"""
    import re as _re
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        return jsonify({'error': 'video not found'}), 404

    duration = float(video.get('duration_sec') or 0.0)
    out = {'duration': duration, 'drops': [], 'scramble': [], 'chapters': [], 'sync': []}

    # 字幕/実況を取り込んだ時の対応区間(tag.json の audio_sync)。どこが取り込み元と
    # 一致した区間で、どこが穴なのかをシークバーに出すため、この動画の秒(a_start/a_end)で返す
    tag = _load_tag((video.get('file_path') or '') + '.tag.json') or {}
    for rec in (tag.get('audio_sync') or []):
        # 実際に取り込みへ使った区間を優先する。生の一致区間(ranges)を出すと、
        # 穴を埋めたぶんが抜けて「半分しか取り込めていない」ように見える
        # （実測: 生は10区間で53%しか覆わないが、字幕は340件すべて
        #   入っている）。古い記録には applied_ranges が無いので従来どおりに落とす。
        if rec.get('applied_ranges'):
            ranges = [{'start': float(r['start']), 'end': float(r['end']), 'offset': 0.0}
                      for r in rec['applied_ranges']
                      if r.get('start') is not None and r.get('end') is not None]
        else:
            ranges = [{'start': float(r['a_start']), 'end': float(r['a_end']),
                       'offset': float(r.get('offset') or 0)}
                      for r in (rec.get('ranges') or [])
                      if r.get('a_start') is not None and r.get('a_end') is not None]
        if not ranges:
            continue
        out['sync'].append({
            'name': (rec.get('source') or {}).get('station') or '取り込み元',
            'method': rec.get('method') or 'audio_xcorr',
            'applied_at': rec.get('applied_at') or '',
            'added': list((rec.get('added') or {}).keys()),
            'ranges': sorted(ranges, key=lambda x: x['start']),
        })

    # drop_error パース。この動画はトリム済み(複数話なら話単位)のため、ドロップの絶対時刻
    # (tot_time)を trim_segments へ写像して出力タイムラインの秒に直す。
    trim_segments = video.get('trim_segments')
    if isinstance(trim_segments, str):
        try:
            trim_segments = json.loads(trim_segments)
        except Exception:
            trim_segments = None
    if not isinstance(trim_segments, list):
        trim_segments = None
    out.update(_build_drops_payload(video.get('drop_error'), duration,
                                    video.get('recording_start_time'),
                                    video.get('recording_end_time'),
                                    trim_segments))

    # chapter_txt パース（OGM 形式: CHAPTER01=HH:MM:SS.mmm / CHAPTER01NAME=...）
    chapter_txt = video.get('chapter_txt') or ''
    if chapter_txt:
        times = {}
        names = {}
        for line in chapter_txt.splitlines():
            m = _re.match(r'^(CHAPTER\d+)=(\d+):(\d+):(\d+)\.(\d+)$', line.strip())
            if m:
                key = m.group(1)
                h, mi, s, ms = int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
                times[key] = h * 3600 + mi * 60 + s + ms / 1000.0
                continue
            m2 = _re.match(r'^(CHAPTER\d+)NAME=(.*)$', line.strip())
            if m2:
                names[m2.group(1)] = m2.group(2)
        for key in sorted(times):
            out['chapters'].append({'sec': times[key], 'name': names.get(key, '')})

    return jsonify(out)
