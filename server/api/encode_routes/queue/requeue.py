"""エンコードキューを消して入れ直す"""

import json
from quart import jsonify, current_app, request, abort
from api.routes.auth import bp
from api.routes.parser import _ruledb
from .transfer import _apply_encodings_priority, _parse_queue_priority


@bp.post('/encode/recordings/<int:rec_id>/requeue')
async def requeue_recording(rec_id):
    """キュー登録済みの録画を、既存エンコードを削除して再登録する。

    body: {priority: 1-5}(任意、既定3)。
    各encodingの Amatsukazeキューitem(CMCheck含む) と tmp作業ディレクトリを purge してから
    create_encodings(既存行削除+wait_encodeで再作成)を実行する。走行中のエンコードは
    行削除で run_one_encoding 側の should_abort が中断する。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    if recording['state'] in ('pending', 'scanning'):
        abort(400, description=f'state={recording["state"]} は再登録できません (スキャン完了後に実行してください)')
    if not recording.get('to_encode_info'):
        abort(400, description='to_encode_info が未設定です（エンコード設定を保存してください）')
    # folder/title の確定値が未設定、または分割結果が全てSKIP のときはエンコードせず
    # state を変えない（waiting のまま据え置く）
    from logic.encode_pipeline.runner.create import check_encodable
    _reason = check_encodable(recording)
    if _reason:
        abort(409, description=f'エンコードできません: {_reason}')
    priority = _parse_queue_priority(await request.get_json(silent=True))

    # ノード委譲は再転送として扱う(スレーブに同一番組があれば冪等スキップ。
    # やり直しはスレーブ側の画面から通常のrequeueで行う)
    from logic.encode_pipeline.runner.transfer import _node_encoder_name
    try:
        _tei = json.loads(recording['to_encode_info'])
    except (json.JSONDecodeError, TypeError):
        _tei = {}
    _node = _node_encoder_name(_tei.get('encode_type', ''))
    if _node:
        import threading as _th
        import logging as _lg
        _cfg = current_app.config['ENCODE_AUTO']
        # ローカルのエンコードは消してから送る。エンコード先をこのサーバーから
        # ノード委譲へ変えて再登録した時、ここを飛ばすと自分のキューに載ったままの
        # エンコードが残り、向こうと二重に走る。
        _old_ids = [e['id'] for e in db.get_encodings(rec_id)]

        def _retransfer():
            from logic.encode_pipeline.discard import discard_encoding
            from logic.encode_pipeline.runner.transfer import transfer_recording_to_node
            log = _lg.getLogger(__name__)
            for eid in _old_ids:
                discard_encoding(db, eid, _cfg, who='requeue_recording')
            if _old_ids:
                log.info('requeue_recording: rec=%d ノード委譲へ変更 → ローカルの'
                         'エンコード %d件を削除', rec_id, len(_old_ids))
            try:
                transfer_recording_to_node(db, rec_id, _cfg, _node, priority)
            except Exception as e:
                log.error('requeue_recording: transfer rec=%d failed: %s', rec_id, e)
        _th.Thread(target=_retransfer, daemon=True).start()
        return jsonify({'state': recording['state'], 'transfer': _node,
                        'purged': len(_old_ids)})

    db.update_recording(rec_id, state='queued', error_message=None)

    import threading
    import logging
    config = current_app.config['ENCODE_AUTO']
    enc_ids = [e['id'] for e in db.get_encodings(rec_id)]

    def _requeue():
        from logic.encode_pipeline.discard import discard_encoding
        from logic.encode_pipeline.runner.create import create_encodings
        log = logging.getLogger(__name__)
        for eid in enc_ids:
            # 行は create_encodings(make_DB) が作り直す時に消す
            discard_encoding(db, eid, config, delete_row=False, who='requeue_recording')
        try:
            create_encodings(db, rec_id, config)
            _apply_encodings_priority(db, rec_id, priority)
            log.info('requeue_recording: rec=%d 再登録完了 (旧encodings %d件をpurge)', rec_id, len(enc_ids))
        except Exception as e:
            log.error('requeue_recording: create_encodings rec=%d failed: %s', rec_id, e)
    threading.Thread(target=_requeue, daemon=True).start()

    return jsonify({'state': 'queued', 'purged': len(enc_ids)})
