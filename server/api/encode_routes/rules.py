"""ルール（programs）と自動エンコード（/api/rules/*, /api/auto_encode/*）"""

import asyncio
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api import schemas
from logic.recordings import confirmed_fields, confirmed_values
from api.routes.auth import bp
from api.routes.rec_aug_rows import _as_list
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _parser, _reparse_fn, _ruledb  # noqa: F401


@bp.get('/rules/<int:rule_id>')
def get_rule(rule_id):
    """予約ごとの解析の記録（ルール）を1件。"""
    rule = _ruledb().get_rule(rule_id)
    if rule is None:
        abort(404, description='ルールが見つかりません')
    return jsonify(schemas.rule_to_response(rule))


# ----------------------------------------------------------------------
# auto_encode（確定値マッチで recordings.auto_send=true にする自動エンコードルール）
# ----------------------------------------------------------------------


@bp.patch('/rules/<int:rule_id>')
async def update_rule(rule_id):
    """ルールの確定値などを変える。話数・話名を変えたら、つながる録画の区間（segments）も計算し直す。"""
    body = await _json()
    rule = _ruledb().get_rule(rule_id)
    if rule is None:
        abort(404, description='ルールが見つかりません')
    fields = schemas.parse_rule_update(body)
    if not fields:
        abort(400, description='更新可能なフィールドがありません')
    _ruledb().update_rule(rule_id, **fields)
    # episode_number/episode_name 更新時: リンク録画の segments を再計算（null または話数変化時のみ）
    recording_segments = None
    if 'episode_number' in fields or 'episode_name' in fields:
        import json as _j
        from logic.recordings.segment_calculator import calculate_segments as _calc_seg
        ep_num_list  = _as_list(fields.get('episode_number'))
        ep_name_list = _as_list(fields.get('episode_name'))
        ep_count = max(len(ep_num_list), len(ep_name_list))
        if ep_count >= 1:
            from logic.recordings.segment_calculator import mark_registered_segments_skip as _mark_skip
            _vdb = current_app.config.get('VIDEO_DB')
            for rec in _ruledb().get_recordings(rule_id):
                existing_raw = rec.get('segments')
                try:
                    existing_segs = _j.loads(existing_raw) if existing_raw else None
                except Exception:
                    existing_segs = None
                if existing_segs is not None and len(existing_segs) == ep_count:
                    continue
                segs = _calc_seg(
                        rec.get('eit_start_time'), rec.get('eit_end_time'), ep_count,
                        rec_start_time=rec.get('recording_start_time'),
                        file_duration_sec=rec.get('duration_sec'),
                    )
                if segs:
                    segs = _mark_skip(
                        segs, _vdb, rec.get('sid'), rec.get('folder'), rec.get('title'),
                        ep_num_list, ep_name_list, categories=rec.get('category'))
                    _ruledb().update_recording(rec['id'], segments=_j.dumps(segs, ensure_ascii=False))
                    recording_segments = segs
                # 既存videoとの重複情報も更新（確定値変更で一致先が変わるため常に再計算）
                try:
                    from logic.recordings.duplicates import build_duplicate_info as _dup
                    dups = _dup(_vdb, rec.get('folder'), rec.get('title'), ep_num_list, ep_name_list)
                    _ruledb().update_recording(rec['id'], duplicate_info=_j.dumps(dups, ensure_ascii=False))
                except Exception:
                    pass
    resp = schemas.rule_to_response(_ruledb().get_rule(rule_id))
    resp['segments'] = recording_segments
    return jsonify(resp)


@bp.post('/rules/<int:rule_id>/reparse')
async def reparse_rule(rule_id):
    """text_parser を再実行して解析結果を更新する"""
    rule = _ruledb().get_rule(rule_id)
    if rule is None:
        abort(404, description='ルールが見つかりません')

    # reserve_key は EDCB の予約なら 'onid-tsid-sid-eid'。アドオンが入れた予約は
    # 別の形（'<アドオン名>:<チャンネル>:<開始時刻>'）なので、そこからは取れない。
    # その場合は programs.sid を見る（無いと SID 0 を引きに行って 404 になっていた）
    reserve_key = rule.get('reserve_key', '')
    parts = reserve_key.split('-')
    onid = tsid = None
    if len(parts) == 4 and all(x.lstrip('-').isdigit() for x in parts):
        onid, tsid, sid = int(parts[0]), int(parts[1]), int(parts[2])
    else:
        sid = int(rule.get('sid') or 0)
    cfg = current_app.config['ENCODE_AUTO']
    context = {
        **cfg.get('text_parser_context', {}),
        'sid':           sid,
        'onid':          onid,
        'tsid':          tsid,
        'service_name':  rule.get('station_name', ''),
        'start_time':    rule.get('start_time', ''),
        'title':         rule.get('original_title', ''),
        'description':   rule.get('original_description', ''),
        'extended_info': rule.get('original_extended_info', ''),
    }
    body = await request.get_json(silent=True) or {}
    title = body.get('title') or rule.get('original_title', '')
    context['title'] = title
    p = _parser(sid)
    # parse_text は syoboi 等への同期HTTP(最大10秒)を含むため to_thread へ逃がす
    # (async ハンドラで直接呼ぶとイベントループが塞がりストリーミングが停止する)
    result = await asyncio.to_thread(_reparse_fn(p), title, context) or {}
    import json as _j_re
    pe = result.get('parser_error') or []
    # recorded 状態のプログラムは state を変えない（録画の見張り再トリガー防止）
    new_state = rule.get('state', 'pending')
    if new_state != 'recorded':
        new_state = 'pending'
    db = _ruledb()
    # 確定値の更新規約は logic/recordings/confirmed_values に集約（ReserveSyncWorker._reparse_rule と共通）
    overwrite = confirmed_values.should_overwrite(rule, bool(rule.get('parser_error')), bool(pe))
    cv_fields = (confirmed_fields.all_fields(result, 'programs') if overwrite
                 else confirmed_fields.missing_fields(rule, result, 'programs'))
    db.update_rule(rule_id,
                   text_parser_result=result,
                   parser_error=_j_re.dumps(pe, ensure_ascii=False),
                   state=new_state, **cv_fields)
    # リンク録画の text_parser_result も同期（recordings/augmented は録画側を優先表示するため）
    result_json = _j_re.dumps(result, ensure_ascii=False)
    pe_json = _j_re.dumps(pe, ensure_ascii=False)
    for rec in db.get_recordings(rule_id):
        rec_ow = confirmed_values.should_overwrite(rec, bool(rec.get('parser_error')), bool(pe))
        rec_fields = (confirmed_fields.all_fields(result, 'recordings') if rec_ow
                      else confirmed_fields.missing_fields(rec, result, 'recordings'))
        db.update_recording(rec['id'],
                            text_parser_result=result_json,
                            parser_error=pe_json, **rec_fields)
    resp = schemas.rule_to_response(db.get_rule(rule_id))
    resp['text_parser_context'] = context
    return jsonify(resp)


@bp.delete('/rules/<int:rule_id>')
def delete_rule(rule_id):
    """ルールを消す。"""
    rule = _ruledb().get_rule(rule_id)
    if rule is None:
        abort(404, description='ルールが見つかりません')
    _ruledb().delete_rule(rule_id)
    return jsonify({'deleted': rule_id})


