"""エンコードの一覧・分割（/api/encode/encodings/*）"""

from quart import jsonify, current_app, abort
from api import schemas
from api.routes.auth import bp
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from .recordings.listing import _perm_filter_encodings  # noqa: F401


# ---------------------------------------------------------------------------
# encodings CRUD + split（Phase 2 拡張）
# ---------------------------------------------------------------------------

@bp.get('/encode/recordings/<int:rec_id>/encodings')
def list_rec_encodings(rec_id):
    """recording に紐付く encodings 一覧（order_index 昇順）。"""
    db = _ruledb()
    if db.get_recording(rec_id) is None:
        abort(404, description='録画が見つかりません')
    encs = db.get_encodings(rec_id)
    return jsonify(_perm_filter_encodings([schemas.encoding_to_response(e) for e in encs]))


@bp.post('/encode/recordings/<int:rec_id>/encodings')
async def create_encoding(rec_id):
    """encoding を state='pending' で作成し、recording の state を encoding_pending に変更。
    recording.state == 'before_split' のみ受け付ける。
    """
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    if recording['state'] != 'before_split':
        abort(400, description=f'state={recording["state"]} には encoding を作成できません (before_split のみ可)')

    body = await _json()
    source_ts_path = recording.get('app_ts_path') or recording.get('amatsukaze_ts_path') or ''

    enc_id = db.add_encoding(
        recording_id=rec_id,
        order_index=body.get('order_index', 0),
        start_offset=body.get('start_offset') or None,
        end_offset=body.get('end_offset') or None,
        episode_number=body.get('episode_number') or None,
        episode_name=body.get('episode_name') or None,
        source_ts_path=source_ts_path or None,
    )
    db.update_recording(rec_id, state='encoding_pending')
    enc = db.get_encoding(enc_id)
    return jsonify(schemas.encoding_to_response(enc)), 201


@bp.patch('/encode/recordings/<int:rec_id>/encodings/<int:enc_id>')
async def update_encoding(rec_id, enc_id):
    """pending 状態の encoding を更新する。"""
    db = _ruledb()
    if db.get_recording(rec_id) is None:
        abort(404, description='録画が見つかりません')
    enc = db.get_encoding(enc_id)
    if enc is None or enc['recording_id'] != rec_id:
        abort(404, description='encoding が見つかりません')
    if enc['state'] != 'pending':
        abort(400, description=f'state={enc["state"]} は更新できません (pending のみ可)')

    body = await _json()
    allowed = {'start_offset', 'end_offset', 'episode_number', 'episode_name', 'order_index'}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        abort(400, description='更新可能なフィールドがありません')
    db.update_encoding(enc_id, **fields)
    return jsonify(schemas.encoding_to_response(db.get_encoding(enc_id)))


@bp.delete('/encode/recordings/<int:rec_id>/encodings/<int:enc_id>')
def delete_encoding(rec_id, enc_id):
    """pending 状態の encoding を削除する。"""
    db = _ruledb()
    if db.get_recording(rec_id) is None:
        abort(404, description='録画が見つかりません')
    enc = db.get_encoding(enc_id)
    if enc is None or enc['recording_id'] != rec_id:
        abort(404, description='encoding が見つかりません')
    if enc['state'] != 'pending':
        abort(400, description=f'state={enc["state"]} は削除できません (pending のみ可)')
    db.delete_encoding(enc_id)
    return jsonify({'deleted': enc_id})


@bp.post('/encode/recordings/<int:rec_id>/cancel_encode')
def cancel_encode_recording(rec_id):
    """録画のエンコードキューを取り消す（この録画の encodings を全て削除して waiting へ戻す）。

    各 encoding は delete_encoding_by_id と同じ手順で片付ける
    （Amatsukaze の Cancel→RemoveItem → tmp 作業ディレクトリ削除 → DB 行削除）。
    録画そのものと TS は消さないので、確定値を直してから再度キューへ載せられる。
    """
    from logic.encode_pipeline.discard import discard_encoding

    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    cfg = current_app.config['ENCODE_AUTO']
    removed = []
    for enc in db.get_encodings(rec_id):
        discard_encoding(db, enc['id'], cfg, who='cancel_encode')
        removed.append(enc['id'])

    # エンコード前の状態へ戻す（確定値を直して再投入できるようにする）
    db.update_recording(rec_id, state='waiting', error_message=None)
    return jsonify({'id': rec_id, 'cancelled': removed, 'state': 'waiting'})


