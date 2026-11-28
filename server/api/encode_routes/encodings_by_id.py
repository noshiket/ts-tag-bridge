"""エンコードを番号で（一覧・1件・変更・削除）"""

from quart import jsonify, current_app, request, abort
from api import schemas
from api.routes.auth import bp, require_screen
from api.routes.parser import _ruledb
from .recordings.listing import _perm_filter_encodings


@bp.delete('/encode/encodings/<int:enc_id>')
def delete_encoding_by_id(enc_id):
    """encoding を DB から削除する（recording 等は消さない）。

    amz_item_id が残っていれば state に関わらず Amatsukaze のタスク（Cancel→RemoveItem）と
    作業ディレクトリ(amt*)を purge してから DB 行を消す（従来は state=encoding のみ
    Cancel/RemoveItem していたため、encode_error 等で消すとキューと amt* が残骸になっていた）。
    削除後は残りの encodings から recording.state を rollup する。
    """
    from logic.encode_pipeline.discard import discard_encoding
    db = _ruledb()
    enc = db.get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding が見つかりません')
    recording_id = enc['recording_id']
    # Amatsukaze の項目 → 作業ディレクトリ(cut.ts + output) → DB 行 の順で片付ける
    discard_encoding(db, enc_id, current_app.config['ENCODE_AUTO'], who='delete_encoding_by_id')

    # 削除時は recording を waiting に戻す（録画自体は消さない）
    db.update_recording(recording_id, state='waiting', error_message=None)

    return jsonify({'deleted': enc_id})


@bp.get('/encode/encodings')
def list_encodings():
    """encodings 一覧。?state= でフィルタ可。"""
    require_screen('encode')
    state = request.args.get('state')
    encs = _ruledb().list_encodings(state=state)
    return jsonify(_perm_filter_encodings([schemas.encoding_to_response(e) for e in encs]))


@bp.get('/encode/encodings/<int:enc_id>')
def get_encoding(enc_id):
    """encoding 詳細取得。"""
    enc = _ruledb().get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding が見つかりません')
    return jsonify(schemas.encoding_to_response(enc))


@bp.patch('/encode/encodings/<int:enc_id>')
async def patch_encoding_by_id(enc_id):
    """encoding の encode_dir / priority を変更する。

    encode_dir: file_copy リトライ前の出力先変更用。app_output_path は
    {$encode_dir} プレースホルダ保存のため、DB 値を変えるだけで次回 file_copy の
    出力先が変わる（'master' 含む）。
    priority: エンコード優先度(1-5、既定3)。エンコードの実行が高い順にディスパッチする。
    """
    db = _ruledb()
    enc = db.get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding が見つかりません')
    body = await request.get_json(silent=True) or {}
    fields = {}
    if 'encode_dir' in body:
        fields['encode_dir'] = (body.get('encode_dir') or '').strip() or None
    if 'priority' in body:
        try:
            p = int(body['priority'])
        except (TypeError, ValueError):
            abort(400, description='priority は数値で指定してください')
        if not 1 <= p <= 5:
            abort(400, description='priority は 1〜5 で指定してください')
        fields['priority'] = p
    if not fields:
        abort(400, description='encode_dir か priority を指定してください')
    db.update_encoding(enc_id, **fields)
    return jsonify(schemas.encoding_to_response(db.get_encoding(enc_id)))
