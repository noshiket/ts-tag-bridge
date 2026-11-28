"""録画の確定値・区間・エンコード設定を変える・列の一覧"""

from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.rec_aug_rows import _as_list
from api.routes.caches import _json
from api.routes.parser import _ruledb


@bp.patch('/encode/recordings/<int:rec_id>/confirmed')
async def patch_recording_confirmed(rec_id):
    """confirmed フィールドを recording に直接保存する。rec_id は recordings.id（DB 主キー）。"""
    import json as _j
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません (DB 未登録)')

    body = await _json()
    _LIST_COLS = {'title', 'furigana', 'folder', 'setting', 'episode_number', 'episode_name', 'category', 'app_output_path'}
    fields = {}
    for key in ('title', 'folder', 'episode_name', 'episode_number', 'category',
                'furigana', 'else_info', 'auto_send', 'app_output_path_format',
                'app_output_path', 'encode_dir', 'setting', 'is_text_parser', 'parser_error'):
        if key not in body:
            continue
        v = body[key]
        if key in _LIST_COLS and isinstance(v, list):
            v = _j.dumps(v, ensure_ascii=False)
        elif key == 'parser_error' and isinstance(v, list):
            v = _j.dumps(v, ensure_ascii=False)
        elif key == 'auto_send' and isinstance(v, (int, bool)):
            v = 'true' if v else 'false'
        fields[key] = v

    if fields:
        db.update_recording(recording['id'], **fields)
    # episode_number/episode_name 更新時: segments 再計算（null または話数変化時のみ）
    recording_segments = None
    if 'episode_number' in fields or 'episode_name' in fields:
        import json as _j
        from logic.recordings.segment_calculator import calculate_segments as _calc_seg
        ep_count = max(len(_as_list(fields.get('episode_number'))), len(_as_list(fields.get('episode_name'))))
        if ep_count >= 1:
            existing_raw = recording.get('segments')
            try:
                existing_segs = _j.loads(existing_raw) if existing_raw else None
            except Exception:
                existing_segs = None
            if existing_segs is None or len(existing_segs) != ep_count:
                segs = _calc_seg(
                    recording.get('eit_start_time'), recording.get('eit_end_time'), ep_count,
                    rec_start_time=recording.get('recording_start_time'),
                    file_duration_sec=recording.get('duration_sec'),
                )
                if segs:
                    from logic.recordings.segment_calculator import mark_registered_segments_skip as _mark_skip
                    latest = db.get_recording(recording['id'])
                    segs = _mark_skip(
                        segs, current_app.config.get('VIDEO_DB'), latest.get('sid'),
                        latest.get('folder'), latest.get('title'),
                        _as_list(latest.get('episode_number')), _as_list(latest.get('episode_name')),
                        categories=latest.get('category'))
                    db.update_recording(recording['id'], segments=_j.dumps(segs, ensure_ascii=False))
                    recording_segments = segs
    # 既存videoとの重複情報を更新（確定値の変更で一致先が変わるため、対象キー変更時は常に再計算）
    if any(k in fields for k in ('title', 'folder', 'episode_number', 'episode_name')):
        try:
            from logic.recordings.duplicates import build_duplicate_info as _dup

            latest = db.get_recording(recording['id'])
            dups = _dup(current_app.config.get('VIDEO_DB'), latest.get('folder'), latest.get('title'),
                        _as_list(latest.get('episode_number')), _as_list(latest.get('episode_name')))
            db.update_recording(recording['id'], duplicate_info=_j.dumps(dups, ensure_ascii=False))
        except Exception as e:
            import logging as _logging
            _logging.getLogger(__name__).warning('patch_recording_confirmed: duplicate_info failed rec=%d: %s',
                                                 recording['id'], e)
    # auto_encode ルール再評価（auto_send を明示編集していない場合のみ）
    if 'auto_send' not in fields:
        from logic.encoding import auto_encode as _ae
        latest = db.get_recording(recording['id'])
        if latest:
            _ae.apply_to_recording(db, latest)
    return jsonify({'id': recording['id'], 'edcb_rec_id': rec_id, 'segments': recording_segments})


@bp.patch('/encode/recordings/<int:db_rec_id>/segments')
async def patch_recording_segments(db_rec_id):
    """分割画面から segments を直接保存する。db_rec_id は recordings.id。"""
    import json as _j
    db = _ruledb()
    recording = db.get_recording(db_rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    body = await _json()
    segs = body.get('segments')
    if not isinstance(segs, list):
        abort(400, description='segments は配列で指定してください')
    db.update_recording(db_rec_id, segments=_j.dumps(segs, ensure_ascii=False))
    return jsonify({'id': db_rec_id, 'segments': segs})


@bp.patch('/encode/recordings/<int:db_rec_id>/encode_info')
async def patch_recording_encode_info(db_rec_id):
    """to_encode_info を更新する。db_rec_id は recordings.id。"""
    import json as _j
    db = _ruledb()
    recording = db.get_recording(db_rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    body = await _json()
    db.update_recording(db_rec_id, to_encode_info=_j.dumps(body, ensure_ascii=False))
    return jsonify({'id': db_rec_id})


@bp.get('/encode/recordings/<int:db_rec_id>/columns')
def get_recording_columns(db_rec_id):
    """recordings の全カラムをスキーマ順で返す（録画詳細のデバッグ表示用）。
    db_rec_id は recordings.id。dict/list は JSON 文字列化して返す。"""
    import json as _j
    db = _ruledb()
    recording = db.get_recording(db_rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません (DB 未登録)')
    cols = {}
    for k, v in recording.items():
        if isinstance(v, (dict, list)):
            cols[k] = _j.dumps(v, ensure_ascii=False)
        else:
            cols[k] = v
    return jsonify({'columns': cols})
