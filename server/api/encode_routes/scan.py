"""EIT・ロゴ・再解析・確定値・ドロップなど、録画の情報の取り直し"""

import data_paths
import os
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.parser import _reparse_fn, _ruledb, _store  # noqa: F401


@bp.post('/encode/recordings/<int:rec_id>/extract_logo')
def extract_logo_from_ts(rec_id):
    """TSファイルから局ロゴ(type1=120x60, type2=36x24)を抽出してデータの置き場の station_logo/ に保存する。
    既存ロゴと同一なら保存しない。内容が異なれば別名(タイムスタンプ付)で保存し旧ファイルは残す。
    rec_id は recordings.id（DB 主キー）。
    """
    import hashlib
    import pathlib
    from datetime import datetime as _dt
    from read_tsprogram.logo_extractor import extract_logos_all_types

    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画がDBに見つかりません。先にEITスキャンを実行してください')

    ts_path = recording.get('app_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(400, description=f'TSファイルが存在しません: {ts_path}')

    logo_dir = pathlib.Path(data_paths.DATA_DIR) / 'station_logo'
    logo_dir.mkdir(parents=True, exist_ok=True)

    all_logos = extract_logos_all_types(ts_path)  # スキャン1回

    saved, skipped = [], []
    for (onid, sid), type_map in all_logos.items():
        seen_stems: set[str] = set()
        for prefer_type in (1, 2):
            data = type_map.get(prefer_type) or type_map.get(min(type_map))
            if not data:
                continue
            w = int.from_bytes(data[16:20], 'big')
            h = int.from_bytes(data[20:24], 'big')
            stem = f'{onid}_{sid}_{w}x{h}'
            if stem in seen_stems:
                continue  # 同サイズのロゴは1回のみ保存
            seen_stems.add(stem)
            canon = logo_dir / f'{stem}.png'
            new_hash = hashlib.md5(data).hexdigest()
            if canon.exists():
                if hashlib.md5(canon.read_bytes()).hexdigest() == new_hash:
                    skipped.append(stem)
                    continue
                ts_stamp = _dt.now().strftime('%Y%m%d_%H%M%S')
                alt = logo_dir / f'{stem}_{ts_stamp}.png'
                alt.write_bytes(data)
                saved.append(str(alt.name))
            else:
                canon.write_bytes(data)
                saved.append(str(canon.name))

    return jsonify({'saved': saved, 'skipped': skipped, 'ts_path': ts_path})


@bp.post('/encode/recordings/<int:rec_id>/reparse')
def reparse_recording_direct(rec_id):
    """eit_title に対して text_parser を再実行し text_parser_result のみ更新する。
    rec_id は recordings.id（DB 主キー）。TSファイルは読まない。確定値は変更しない。
    """
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません (DB 未登録)')

    # 通常フロー(予約の同期)はEPG取込時にnormalize_text済みのtitleで解析している。
    # 再解析も同じ正規化(波ダッシュ〜→~ 等)を通さないと、パターンのswitch比較
    # (半角~で保存されている)に一致せずelseへ落ちて結果が食い違う
    from read_tsprogram.program_info import normalize_text as _tp_norm
    title = _tp_norm(recording.get('eit_title') or '')
    sid   = recording.get('sid') or 0
    cfg   = current_app.config['ENCODE_AUTO']
    tp_context = {
        **cfg.get('text_parser_context', {}),
        'sid':           sid,
        'onid':          recording.get('onid'),
        'tsid':          recording.get('tsid'),
        'service_name':  recording.get('eit_station_name', '') or '',
        'start_time':    recording.get('eit_start_time', '') or '',
        'title':         title,
        'description':   recording.get('eit_description', '') or '',
        'extended_info': recording.get('eit_extended_info', '') or '',
    }
    tp_parser = _store().get_parser(sid)
    tp_result  = _reparse_fn(tp_parser)(title, context=tp_context) if tp_parser else None
    import json as _j_rr
    tp_result_json = _j_rr.dumps(tp_result, ensure_ascii=False) if tp_result else None
    # マッチしなかったことも parser_error に残す（パターン未設定の局は対象外）
    from text_parser.parser.common import parser_errors
    db.update_recording(recording['id'], text_parser_result=tp_result_json,
                        parser_error=(parser_errors(tp_result) if tp_parser else []))
    # 録画一覧（augmented）は 35 秒持つので、直後に開き直すと前の結果が出る
    from api.routes.caches import _invalidate_rec_aug_cache
    _invalidate_rec_aug_cache()
    return jsonify({'id': recording['id'], 'edcb_rec_id': rec_id, 'text_parser_result': tp_result, 'text_parser_context': tp_context})


@bp.post('/encode/recordings/<int:rec_id>/scan_times')
def scan_times_recording(rec_id):
    """TSファイルの TOT から録画開始・終了時刻を再取得して recording_start_time / recording_end_time を更新する。
    state に関わらず実行可能。
    """
    from read_tsprogram import scanner as _ts

    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')

    ts_path = recording.get('app_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path:
        abort(400, description='ts_path が設定されていません')

    try:
        times = _ts.get_recording_times(ts_path)
    except Exception as e:
        abort(502, description=str(e))

    db.update_recording(rec_id, **times)
    return jsonify({'id': rec_id, **times})


@bp.post('/encode/recordings/<int:rec_id>/scan_drops')
def scan_drops_recording(rec_id):
    """TSファイルのパケット異常チェックを再実行して drop_error を更新する。
    state に関わらず実行可能。
    """
    from read_tsprogram import scanner as _ts

    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')

    ts_path = recording.get('app_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path:
        abort(400, description='ts_path が設定されていません')

    try:
        drop_error = _ts.check_drops(ts_path)
    except Exception as e:
        abort(502, description=str(e))

    db.update_recording(rec_id, drop_error=drop_error)


    import json as _json
    parsed = _json.loads(drop_error)
    return jsonify({
        'id':             rec_id,
        'total_packets':  parsed['total_packets'],
        'error_count':    parsed['error_count'],
        'drop_count':     parsed['drop_count'],
        'scramble_count': parsed['scramble_count'],
        'other_count':    parsed['other_count'],
    })
