"""EDCB・TS からの録画の登録と再スキャン"""

import os
import threading
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401


@bp.post('/encode/recordings/register_ts')
async def register_recording_ts():
    """B-1B: TS ファイルパス（edcb パス）を指定して read_tsprogram でスキャン・recordings に新規 INSERT する。
    program_id は不要（予約なし TS のため）。

    リクエストボディ:
        {"ts_path": str}
    """
    from logic.storage import path_translator as _pt
    from read_tsprogram import scanner as _ts

    body = await _json()
    ts_path = body.get('ts_path')
    if not ts_path:
        abort(400, description='ts_path が必要です')

    config = current_app.config['ENCODE_AUTO']
    paths  = _pt.translate_paths(ts_path, config)
    try:
        ts_result = _ts.scan_ts(paths['app_ts_path'], offset_sec=5)
    except Exception as e:
        abort(502, description=str(e))

    new_id = _ruledb().add_recording(
        None, None,
        onid=ts_result.get('nid'),
        tsid=ts_result.get('tsid'),
        sid=ts_result.get('sid'),
        eid=ts_result.get('event_id'),
        eit_start_time=ts_result.get('start_time') or None,
        eit_end_time=ts_result.get('end_time') or None,
        **paths,
    )
    _ruledb().update_recording(new_id,
        eit_title=ts_result.get('title', ''),
        eit_description=ts_result.get('description', ''),
        eit_extended_info=ts_result.get('extended_info', ''),
        eit_station_name=ts_result.get('service_name', ''),
        file_exist=int(os.path.exists(paths['app_ts_path'])),
    )

    return jsonify({'id': new_id}), 201


@bp.post('/encode/recordings/rescan')
async def rescan_recordings_bulk():
    """複数の録画ファイルを一括で found に戻してTS再スキャンを促す。

    リクエストボディ:
        {"ids": [1, 2, 3]}   // 必須
    """
    body = await _json()
    ids = body.get('ids')
    if not ids or not isinstance(ids, list):
        abort(400, description='ids 配列が必要です')

    db = _ruledb()
    updated = []
    skipped = []
    for rec_id in ids:
        recording = db.get_recording(rec_id)
        if recording is None:
            skipped.append({'id': rec_id, 'reason': 'not_found'})
            continue
        if recording['state'] not in ('error', 'waiting', 'pending', 'scanning'):
            skipped.append({'id': rec_id, 'reason': f'state={recording["state"]}'})
            continue
        db.update_recording(rec_id, state='pending', error_message=None)
        updated.append(rec_id)


    return jsonify({'updated': updated, 'skipped': skipped})


@bp.get('/encode/recordings/<int:rec_id>/probe')
def probe_recording(rec_id):
    """ffprobe でビデオ/オーディオストリーム情報を返す。結果は DB にキャッシュする。"""
    import json as _j
    from media.probe.ffprobe import get_video_info
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    cached = recording.get('probe_result')
    if cached:
        try:
            return jsonify(_j.loads(cached))
        except Exception:
            pass
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    config = current_app.config['ENCODE_AUTO']
    info = get_video_info(config.get('ffprobe', 'ffprobe'), ts_path)
    if info is None:
        abort(500, description='ffprobe 実行失敗')
    db.update_recording(rec_id, probe_result=_j.dumps(info, ensure_ascii=False))
    return jsonify(info)


# その場でサムネを作る ffmpeg は同時に1本まで。録画一覧にサムネの無い録画が何件もあると、
# 一覧の表示・更新のたびにその数だけ ffmpeg が TS を読み、解析と同じディスクを取り合って
# 遅くなる。同期の API は少数のスレッドで回るので、それが埋まるとライブラリなど他の画面の
# 要求まで待たされていた（画面を移っても、走り出した ffmpeg は最後まで止まらない）。
_THUMB_GEN_LOCK = threading.Lock()


@bp.get('/encode/recordings/<int:rec_id>/thumbnail')
def thumbnail_recording(rec_id):
    """保存済み WebP サムネイルがあればそれを返す。なければ ffmpeg でリアルタイム生成。"""
    from quart import request as _req, Response
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    thumbnail_path = recording.get('thumbnail_path')
    if thumbnail_path and os.path.exists(thumbnail_path):
        with open(thumbnail_path, 'rb') as _f:
            resp = Response(_f.read(), mimetype='image/webp')
        # 一覧の更新(30秒ごと)のたびに取り直させない
        resp.headers['Cache-Control'] = 'private, max-age=300'
        return resp
    # 解析待ち・解析中は作らない（解析がサムネを作って保存する。画面は代わりの絵を出す）
    if recording.get('state') in ('pending', 'scanning'):
        abort(404, description='解析が終わるまでサムネはありません')
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    from media.probe.thumbnail_grab import get_thumbnail
    try:
        t = float(_req.args.get('t', 5.0))
    except ValueError:
        t = 5.0
    config = current_app.config['ENCODE_AUTO']
    if not _THUMB_GEN_LOCK.acquire(blocking=False):
        abort(503, description='ほかのサムネを作っています')
    try:
        data = get_thumbnail(config.get('ffmpeg', 'ffmpeg'), ts_path, timestamp_sec=t)
    finally:
        _THUMB_GEN_LOCK.release()
    if data is None:
        abort(500, description='サムネイル生成失敗')
    return Response(data, mimetype='image/jpeg')
