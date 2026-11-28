"""録画の番組情報を、TS の冒頭から指定の秒数ずらした時点で読み直す（録画詳細の「…」から）

ふだんの取り込みは、ファイル全体で一番長く放送中だった番組を選ぶ。録画の中の別の番組
（前の番組の終わり・続けて録った2本目など）の情報が欲しい時に、時刻を指定して取り直す。
頭から最大 100 万パケット（約 188MB）だけ読む。同じ EIT は読み直さないのでメモリは増えにくいが、
重ねて走らせないよう1件ずつにする。
"""

import asyncio
import os
import threading

from quart import abort, current_app, jsonify, request

from api.routes.auth import bp
from api.routes.parser import _ruledb, _store

_lock = threading.Lock()


@bp.post('/encode/recordings/<int:rec_id>/scan_eit_head')
async def scan_eit_head_recording(rec_id):
    """body: {offset_sec?: int}（無ければ 予約の開始マージン + 15 秒）。読んだ番組情報を返す。"""
    body = await request.get_json(silent=True) or {}
    offset = body.get('offset_sec')
    if offset is not None:
        try:
            offset = int(offset)
        except (TypeError, ValueError):
            abort(400, description='offset_sec は秒数（整数）で指定してください')
        if offset < 0:
            abort(400, description='offset_sec は 0 以上にしてください')
    if not _lock.acquire(blocking=False):
        abort(409, description='ほかの録画の番組情報を読み直しています')
    try:
        # 重い読み込みは別のスレッドで（ほかの要求を止めない）。DB などは要求の中で受け取って渡す
        args = (rec_id, offset, current_app.config['ENCODE_AUTO'], _ruledb(), _store())
        return jsonify(await asyncio.to_thread(_scan, *args))
    finally:
        _lock.release()


def _scan(rec_id, offset, config, db, store):
    from read_tsprogram import scanner as ts_scanner
    from logic.add_recording.reparse import reparse_from_ts
    from logic.add_recording.scan_program import _apply_ts_result, default_offset_sec

    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    if recording.get('state') in ('pending', 'scanning'):
        abort(409, description='取り込みの最中です。終わってからやり直してください')
    ts_path = recording.get('app_ts_path') or recording.get('edcb_ts_path') or ''
    if not ts_path or not os.path.exists(ts_path):
        abort(400, description=f'TSファイルが見つかりません: {ts_path}')
    if offset is None:
        offset = default_offset_sec(db, recording)

    try:
        ts_result = ts_scanner.scan_ts(ts_path, target_sid=recording.get('sid') or None, offset_sec=offset)
    except Exception as e:
        abort(502, description=f'番組情報を読めませんでした: {e}')

    fields = {}
    _apply_ts_result(rec_id, recording, ts_result, fields, recording.get('sid') or 0)
    db.update_recording(rec_id, **fields)
    # 番組名が変わったら解析し直す（ふだんの取り込みと同じ決まり）
    reparse_from_ts(db, rec_id, config, store)
    from api.routes.caches import _invalidate_rec_aug_cache
    _invalidate_rec_aug_cache()
    return {'id': rec_id, 'offset_sec': offset, **ts_result}
