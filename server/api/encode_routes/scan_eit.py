"""録画の番組情報（EIT）を読み直す"""

import os
import re
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.edcb_call import _call, _client
from api.routes.parser import _ruledb


@bp.post('/encode/recordings/<int:rec_id>/scan_eit')
def scan_eit_recording(rec_id):
    """TSファイル再スキャン（eit_* / onid / tsid / sid / eid 等の更新）を要求する。
    rec_id は recordings.id（DB 主キー）。
    DB に見つからない場合は EDCB の録画 ID とみなして自動登録する。
    実処理は同期せず state=pending にして録画の走査に委ねる（非同期再スキャン）。
    state に関わらず実行可能。
    """
    from logic.storage import path_translator as _pt
    from datetime import datetime as _dt, timedelta as _td

    db = _ruledb()
    # recordings.id を優先（DB 主キー）。後方互換で EDCB の rec_id 列でも引く。
    recording = db.get_recording(rec_id) or db.get_recording_by_rec_id(rec_id)

    if recording is None:
        # DB 未登録 → rec_id を EDCB の録画 ID とみなして情報取得し新規登録
        edcb_rec = _call(_client().enum_rec_info, id=str(rec_id))
        if isinstance(edcb_rec, list):
            edcb_rec = edcb_rec[0] if edcb_rec else None
        if not edcb_rec:
            abort(404, description='EDCB に該当録画が見つかりません')

        ts_path_edcb = edcb_rec.get('recFilePath', '')
        if not ts_path_edcb:
            abort(400, description='EDCB recFilePath が空です')

        onid = edcb_rec.get('onid')
        tsid = edcb_rec.get('tsid')
        sid  = edcb_rec.get('sid')
        eid  = edcb_rec.get('eid')

        # program を自動照合（reserve_key 一致）
        reserve_key = f'{onid}-{tsid}-{sid}-{eid}'
        program_row = db.get_by_key(reserve_key)
        program_id  = program_row['id'] if program_row else None

        config = current_app.config['ENCODE_AUTO']
        paths  = _pt.translate_paths(ts_path_edcb, config)

        start_epg = edcb_rec.get('startTimeEpg') or ''
        dur = edcb_rec.get('durationSecond')
        eit_end = ''
        if start_epg and dur is not None:
            try:
                eit_end = (_dt.fromisoformat(start_epg) + _td(seconds=dur)).isoformat()
            except (ValueError, TypeError):
                pass

        new_id = db.add_recording(
            program_id, rec_id,
            onid=onid, tsid=tsid, sid=sid, eid=eid,
            rec_status=edcb_rec.get('recStatus'),
            rec_comment=edcb_rec.get('comment', ''),
            eit_start_time=start_epg or None,
            eit_end_time=eit_end or None,
            **paths,
        )
        db.update_recording(new_id,
            eit_title=edcb_rec.get('title', ''),
            eit_station_name=edcb_rec.get('serviceName', ''),
            file_exist=int(os.path.exists(paths.get('app_ts_path', ''))),
            rec_drops=edcb_rec.get('drops', 0),
            rec_scrambles=edcb_rec.get('scrambles', 0),
        )
        if program_id:
            db.update_rule(program_id, state='recorded')
        recording = db.get_recording(new_id)

    # rec_comment が「一部のみ録画」系の場合、ベースファイルもチェック
    if '一部' in (recording.get('rec_comment') or ''):
        edcb_path = recording.get('edcb_ts_path', '')
        _bm = re.match(r'^(.*)-\(\d+\)(\.[^.]+)$', edcb_path)
        if _bm:
            base_edcb = _bm.group(1) + _bm.group(2)
            if not db.has_recording_with_edcb_path(base_edcb):
                base_paths = _pt.translate_paths(base_edcb, current_app.config['ENCODE_AUTO'])
                host_base = base_paths.get('host_ts_path', base_edcb)
                if os.path.exists(host_base):
                    db.add_recording(
                        recording.get('program_id'), None,
                        onid=recording.get('onid'), tsid=recording.get('tsid'),
                        sid=recording.get('sid'), eid=recording.get('eid'),
                        rec_status=recording.get('rec_status'),
                        rec_comment=f'base of {os.path.basename(edcb_path)}',
                        eit_start_time=recording.get('eit_start_time'),
                        eit_end_time=recording.get('eit_end_time'),
                        edcb_tag=recording.get('edcb_tag', ''),
                        **base_paths,
                    )

    # 同期スキャンはせず state=pending にして録画の走査に再スキャンを委ねる。
    # pending 録画は録画の走査が _ar.process（TS 再スキャン/text_parser/segments → waiting）で
    # 処理する＝従来 scan_eit が同期実行していた処理と同一。重い処理で HTTP をブロックしない。
    db.update_recording(recording['id'], state='pending')
    return jsonify(db.get_recording(recording['id']))
