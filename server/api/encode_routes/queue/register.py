"""録画をキューへ入れる（入れ直し・EDCB からの登録）"""

import json
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.edcb_call import _call, _client  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from .transfer import _apply_encodings_priority, _parse_queue_priority  # noqa: F401


@bp.post('/encode/recordings/<int:rec_id>/queue')
async def queue_recording(rec_id):
    """waiting / error 状態の録画を手動でエンコードキューに載せる。

    body: {priority: 1-5}(任意、既定3)。エンコードの実行が優先度の高い順にディスパッチする。
    初期処理として make_DB（encodings 行の作成）をバックグラウンドで実行する
    （create_encodings: 既存 encodings を削除して wait_encode で作り直す）。
    実エンコードはエンコードの実行ディスパッチャが encodings 単位（run_one_encoding）で実行する。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    # waiting(<node>) は waiting と同じ扱い(スレーブで実行中の可視化表記)
    state = recording['state']
    if state not in ('waiting', 'error') and not state.startswith('waiting('):
        abort(400, description=f'state={state} はキュー登録できません (waiting/error のみ可)')
    if not recording.get('to_encode_info'):
        abort(400, description='to_encode_info が未設定です（エンコード設定を保存してください）')
    # folder/title の確定値が未設定、または分割結果が全てSKIP のときはエンコードせず
    # state を変えない（waiting のまま据え置く）
    from logic.encode_pipeline.runner.create import check_encodable
    _reason = check_encodable(recording)
    if _reason:
        abort(409, description=f'エンコードできません: {_reason}')
    priority = _parse_queue_priority(await request.get_json(silent=True))

    import threading
    import logging
    config = current_app.config['ENCODE_AUTO']

    # ノード委譲(encode_type='node:<name>'): ローカルのキューには載せず、録画そのもの
    # (TS+メタ)をスレーブへ転送して向こうで自動キュー投入させる(録画転送型)。
    # マスター側の state は変えない(スレーブの投入通知で waiting(<node>) になり、
    # 完了時は既存の重複削除がこの録画+TSを自動掃除する)
    from logic.encode_pipeline.runner.transfer import _node_encoder_name
    try:
        _tei = json.loads(recording['to_encode_info'])
    except (json.JSONDecodeError, TypeError):
        _tei = {}
    node_name = _node_encoder_name(_tei.get('encode_type', ''))
    if node_name:
        def _transfer():
            from logic.encode_pipeline.runner.transfer import transfer_recording_to_node
            try:
                transfer_recording_to_node(db, rec_id, config, node_name, priority)
            except Exception as e:
                logging.getLogger(__name__).error(
                    'queue_recording: transfer rec=%d failed: %s', rec_id, e)
        threading.Thread(target=_transfer, daemon=True).start()
        return jsonify({'state': state, 'transfer': node_name})

    db.update_recording(rec_id, state='queued', error_message=None)

    # make_DB（encodings 行作成）はバックグラウンドで実行。TS 不在等の失敗時は
    # create_encodings 内で recordings.state='error' になる。
    def _make():
        from logic.encode_pipeline.runner.create import create_encodings
        try:
            create_encodings(db, rec_id, config)
            _apply_encodings_priority(db, rec_id, priority)
        except Exception as e:
            logging.getLogger(__name__).error('queue_recording: create_encodings rec=%d failed: %s', rec_id, e)
    threading.Thread(target=_make, daemon=True).start()

    return jsonify({'state': 'queued'})


@bp.post('/encode/recordings/register_edcb')
async def register_recording_edcb():
    """B-1A: EDCB の edcb_rec_id を指定して EnumRecInfo からデータ取得・recordings に新規 INSERT する。
    program は onid/tsid/sid/eid で自動照合（フォールバック: sid + start_time 2分以内）。

    リクエストボディ:
        {"edcb_rec_id": int}
    """
    from datetime import datetime, timedelta
    from logic.storage import path_translator as _pt

    body = await _json()
    edcb_rec_id = body.get('edcb_rec_id')
    if edcb_rec_id is None:
        abort(400, description='edcb_rec_id が必要です')

    rec = _call(_client().enum_rec_info, id=str(edcb_rec_id))
    if isinstance(rec, list):
        rec = rec[0] if rec else None
    if not rec:
        abort(404, description='EDCB に該当録画が見つかりません')

    ts_path = rec.get('recFilePath', '')
    if not ts_path:
        abort(400, description='recFilePath が空です')

    onid = rec.get('onid')
    tsid = rec.get('tsid')
    sid  = rec.get('sid')
    eid  = rec.get('eid')

    # program を自動照合: reserve_key の完全一致 → sid + start_time 近傍
    db = _ruledb()
    reserve_key = f'{onid}-{tsid}-{sid}-{eid}'
    program = db.get_by_key(reserve_key)
    if program is None:
        rec_start = rec.get('startTime', '')
        try:
            rec_dt = datetime.fromisoformat(rec_start)
            for p in db.list_rules():
                parts = p.get('reserve_key', '').split('-')
                if len(parts) == 4 and int(parts[2]) == sid:
                    try:
                        if abs((datetime.fromisoformat(p['start_time']) - rec_dt).total_seconds()) <= 120:
                            program = p
                            break
                    except (ValueError, TypeError):
                        continue
        except (ValueError, TypeError):
            pass
    if program is None:
        abort(404, description='対応する program が見つかりません')

    program_id = program['id']
    start_epg  = rec.get('startTimeEpg') or ''
    dur        = rec.get('durationSecond')
    if start_epg and dur is not None:
        try:
            eit_end = (datetime.fromisoformat(start_epg) + timedelta(seconds=dur)).isoformat()
        except (ValueError, TypeError):
            eit_end = ''
    else:
        eit_end = ''

    config = current_app.config['ENCODE_AUTO']
    paths  = _pt.translate_paths(ts_path, config)
    new_id = db.add_recording(
        program_id, edcb_rec_id,
        onid=onid, tsid=tsid, sid=sid, eid=eid,
        rec_status=rec.get('recStatus'),
        rec_comment=rec.get('comment', ''),
        eit_start_time=start_epg or None,
        eit_end_time=eit_end or None,
        **paths,
    )
    db.update_recording(new_id,
        eit_title=rec.get('title', ''),
        eit_station_name=rec.get('serviceName', ''),
        file_exist=int(os.path.exists(paths['app_ts_path'])),
        rec_drops=rec.get('drops', 0),
        rec_scrambles=rec.get('scrambles', 0),
    )
    db.update_rule(program_id, state='recorded')

    return jsonify({'id': new_id, 'program_id': program_id}), 201
