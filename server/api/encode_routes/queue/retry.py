"""エンコードのやり直し（選んだ工程から）"""

import asyncio
import json
from quart import jsonify, current_app, request, abort
from api.routes.auth import bp
from api.routes.parser import _ruledb


@bp.post('/encode/encodings/<int:enc_id>/retry')
async def retry_encoding(enc_id):
    """
    state 指定でエンコードを再実行する。
    body: {"state": "make_DB" | "split_ts" | "encoding" | "encoded_analyze" | "file_copy"}
    state 省略時は make_DB（全工程やり直し）。

    実行はエンコードの実行ディスパッチャ（encodings 単位）に一本化する。
      - make_DB: create_encodings で encodings を作り直す（バックグラウンド）。
      - それ以外（split_ts/…）: 当該 enc を target_state にリセットするだけ。
    実エンコードはエンコードの実行が pending encoding を enc.id 順で1本ずつ直列に拾い、
    run_one_encoding 内の _verify_and_route が split 済み cut.ts や Amatsukaze 登録済み
    item から再開・既存 item を再利用する（ゼロから入れ直さない）。

    stop_after（make_DB のみ実行などデバッグ用・エンコードを伴わない）だけは同期実行。
    """
    VALID_STATES = {'make_DB', 'split_ts', 'encoding', 'encoded_analyze', 'file_copy'}

    db = _ruledb()
    enc = db.get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding not found')

    recording_id = enc['recording_id']
    rec = db.get_recording(recording_id)
    # この録画が現在エンコード中（エンコードの実行が処理中）なら不可。完了/失敗を待つ。
    if rec and rec.get('state') == 'encoding':
        abort(400, description='この録画は現在エンコード中です。完了後に再実行してください')

    body = await request.get_json(silent=True) or {}
    target_state = body.get('state', 'make_DB')
    if target_state not in VALID_STATES:
        abort(400, description=f'state={target_state} は無効です ({", ".join(sorted(VALID_STATES))})')

    stop_after = body.get('stop_after')

    # 失敗した工程より先からのやり直しは受け付けない。その工程が作るはずの成果物が
    # 無い(または壊れた)まま進んでしまい、失敗を繰り返すか不正な成果物ができる。
    # 例: encoded_analyze で失敗したものを file_copy からやり直すと、不正と判定された
    # 出力をそのままライブラリへ入れてしまう。
    from logic.encode_pipeline.base.states import STATE_NUM
    try:
        _ei = json.loads(enc.get('encode_info') or '{}')
    except (json.JSONDecodeError, TypeError):
        _ei = {}
    failed_state = _ei.get('failed_state')
    if (enc.get('state') == 'encode_error' and failed_state in STATE_NUM
            and STATE_NUM.get(target_state, 0) > STATE_NUM[failed_state]):
        abort(400, description=(
            f'{failed_state} で失敗しているので、それより先の {target_state} からは'
            f'やり直せません（{failed_state} かそれより前を選んでください）'))

    import threading
    import logging
    config = current_app.config['ENCODE_AUTO']

    if target_state == 'make_DB':
        # make_DB retry: encodings を作り直す（create_encodings が既存削除＋再作成）。
        # 各行は wait_encode で作成され、エンコードの実行が encodings 単位で拾う。
        from logic.encode_pipeline.runner.create import create_encodings

        if stop_after is not None:
            # デバッグ: DB 作成のみ同期実行（エンコードしない）
            try:
                create_encodings(db, recording_id, config)
            except Exception as e:
                logging.getLogger(__name__).error('retry make_DB(stop_after) rec=%d failed: %s', recording_id, e)
            return jsonify({'status': 'started', 'enc_id': enc_id, 'state': target_state, 'stop_after': stop_after})

        def _make():
            try:
                create_encodings(db, recording_id, config)
            except Exception as e:
                logging.getLogger(__name__).error('retry make_DB rec=%d failed: %s', recording_id, e)
        threading.Thread(target=_make, daemon=True).start()
        return jsonify({'status': 'queued', 'enc_id': enc_id, 'state': target_state})

    # per-step retry: 当該 enc を target_state にリセット → エンコードの実行が enc.id 順で拾い、
    # _verify_and_route が成果物に応じて再開する。recordings.state は rollup で更新。
    from logic.encode_pipeline.base.context import _update_recording_rollup

    if target_state == 'encoding':
        # 滞留している Amatsukaze item + amt_dir をパージしてからクリーンな状態で入れ直す。
        # エンコードの実行の自動再開（クラッシュ復旧）は run_encoding 内の再利用ロジックで対応するため、
        # このパージは手動リトライ時のみ実行する。
        from logic.encode_pipeline.amatsukaze.amt_dir import purge_amz_item_for_retry
        await asyncio.to_thread(purge_amz_item_for_retry, db, enc_id, config)

    db.update_encoding(enc_id, state=target_state, error_message=None)
    _update_recording_rollup(db, recording_id)
    return jsonify({'status': 'queued', 'enc_id': enc_id, 'state': target_state})
