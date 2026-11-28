"""エンコードを話ごとに分ける・シークバーのサムネ"""

import os
from quart import jsonify, current_app, abort, Response
from api import schemas
from api.routes.auth import bp
from api.routes.parser import _ruledb


@bp.post('/encode/encodings/<int:enc_id>/split')
def split_encoding(enc_id):
    """pending 状態の encoding を split 実行（手動トリガー）。

    分割あり: ts_split.split_recording() で TS 分割
    分割なし: shutil.copy2() で tmp_dir にコピー
    """
    import shutil
    from logic.storage import tmp_dir as _tmp
    from logic import ts_split as _ts_split

    db = _ruledb()
    enc = db.get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding が見つかりません')
    if enc['state'] != 'pending':
        abort(400, description=f'state={enc["state"]} は split できません (pending のみ可)')

    source_ts_path = enc.get('source_ts_path') or ''
    if not source_ts_path:
        abort(400, description='source_ts_path が設定されていません')

    recording = db.get_recording(enc['recording_id'])
    if recording is None:
        abort(404, description='関連する録画が見つかりません')

    config = current_app.config['ENCODE_AUTO']
    tmp_base = config.get('tmp_base', '')
    if not tmp_base:
        abort(503, description='tmp_base が未設定')

    # tmp_dir 作成
    try:
        tmp_path = _tmp.create_tmp_dir(tmp_base)
    except Exception as e:
        abort(502, description=f'tmp_dir 作成失敗: {e}')

    db.update_encoding(enc_id, state='splitting', tmp_dir=tmp_path)

    try:
        if enc.get('start_offset'):
            output_filename = f'seg_{enc_id}.ts'
            output_paths = _ts_split.split_recording(
                source_ts_path,
                [{'start_offset': enc['start_offset'],
                  'end_offset': enc['end_offset'],
                  'output_filename': output_filename}],
                tmp_path,
            )
            input_path = output_paths[0]
        else:
            output_filename = os.path.basename(source_ts_path)
            dst = os.path.join(tmp_path, output_filename)
            shutil.copy2(source_ts_path, dst)
            input_path = dst

        _prog = db.get_rule(recording['program_id'])
        _op = _prog.get('app_output_path') if _prog else None
        output_path  = (_op[0] if isinstance(_op, list) else _op) or ''

        db.update_encoding(enc_id,
                           input_path=input_path,
                           output_path=output_path,
                           state='split_done')
    except Exception as e:
        db.update_encoding(enc_id, state='error', error_message=str(e))
        abort(502, description=str(e))

    return jsonify(schemas.encoding_to_response(db.get_encoding(enc_id)))


@bp.get('/encode/recordings/<int:rec_id>/thumbnail-tile')
def thumbnail_tile_recording(rec_id: int):
    """シークバー用のサムネイルタイル（スプライト WebP）を返す。無ければ 404。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    tile_path = recording.get('thumbnail_tile_path')
    if tile_path and os.path.exists(tile_path):
        with open(tile_path, 'rb') as f:
            return Response(f.read(), mimetype='image/webp',
                            headers={'Cache-Control': 'max-age=86400'})
    abort(404, description='サムネイルタイルがありません')
