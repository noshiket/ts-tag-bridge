"""録画の片付け（ファイルの無い録画）とアドオンを録画に掛ける"""

from quart import jsonify, current_app, request, abort
from api.routes.auth import bp
from api.routes.edcb_call import _call, _client
from api.routes.parser import _ruledb


@bp.post('/recordings/cleanup')
def cleanup_recordings():
    """TS ファイルが存在しない録画エントリを EDCB と DB の両方から削除。"""
    import os
    from logic.storage import path_translator as _pt

    config = current_app.config['ENCODE_AUTO']
    client = _client()
    db = _ruledb()

    edcb_deleted = 0
    edcb_items = _call(client.enum_rec_info) or []
    for item in edcb_items:
        ts_path_edcb = item.get('recFilePath', '')
        if not ts_path_edcb:
            continue
        paths = _pt.translate_paths(ts_path_edcb, config)
        host_path = paths.get('host_ts_path') or ts_path_edcb
        if not os.path.exists(host_path):
            try:
                _call(client.del_rec_info, item['id'])
                edcb_deleted += 1
            except Exception as e:
                current_app.logger.warning('cleanup: EDCB の録画情報 %s の削除に失敗: %s', item['id'], e)

    db_deleted = db.cleanup_missing_files()

    return jsonify({'deleted': edcb_deleted + db_deleted,
                    'edcb_deleted': edcb_deleted, 'db_deleted': db_deleted})


@bp.post('/encode/recordings/<int:rec_id>/addons/<name>/run')
async def run_recording_addon(rec_id, name):
    """録画(TS)を対象にアドオンを実行する。ロゴ生成のように元TSが要るもの用。"""
    from logic.addons import addon_runner
    params = await request.get_json(silent=True) or {}
    err, job_id = addon_runner.start_addon(
        name, None, params,
        config=current_app.config['ENCODE_AUTO'],
        video_db=current_app.config.get('VIDEO_DB'),
        rule_db=current_app.config.get('RULE_DB'),
        users_db=current_app.config.get('USERS_DB'),
        recording_id=rec_id)
    if err == 'video_not_found':
        abort(404, description='録画のTSが見つかりません')
    if err == 'not_found':
        abort(404, description=f'アドオン {name} が見つかりません')
    if err == 'busy':
        abort(409, description='この録画で別のアドオンが実行中です')
    return jsonify({'job_id': job_id}), 202
