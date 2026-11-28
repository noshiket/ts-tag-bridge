"""録画を他のサーバーへ送ってエンコードしてもらう（優先度つき）"""

import json
import logging
from typing import Optional
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.parser import _ruledb


def _parse_queue_priority(body) -> Optional[int]:
    """queue/requeue の body から優先度(1-5)を取り出す。未指定はNone(既定3のまま)。"""
    p = (body or {}).get('priority')
    if p is None:
        return None
    try:
        p = int(p)
    except (TypeError, ValueError):
        abort(400, description='priority は数値で指定してください')
    if not 1 <= p <= 5:
        abort(400, description='priority は 1〜5 で指定してください')
    return p


def _apply_encodings_priority(db, rec_id: int, priority: Optional[int]) -> None:
    """作成済みencodingsへ優先度を適用する(未指定/既定3はスキップ)。"""
    if priority is None or priority == 3:
        return
    for enc in db.get_encodings(rec_id):
        if enc.get('state') not in ('encode_end', 'encode_error'):
            db.update_encoding(enc['id'], priority=priority)


@bp.post('/encode/recordings/<int:rec_id>/transfer')
async def transfer_recording(rec_id):
    """録画(TS+DBの内容)を別のサーバーへ転送する。エンコードはしない。

    body: {"node": "<連携ノード名>", "encode": true|false（任意）}

    既定では、この録画のエンコード先が同じノードに設定されていれば向こうで
    キューに載せ、そうでなければ転送だけにする。失敗した転送をやり直す時に
    意味が変わらないようにするため。転送だけの場合、向こうでは
    waiting のまま置かれる。マスター側の録画とTSはそのまま残るので、要らなければ
    録画詳細から消す（押し戻される成果物が無く、自動で消す判断材料が無いため）。

    数GBを送るので投げっぱなしにし、進み具合は recordings.transfer_state で見る。
    """
    import threading

    body = await _json()
    node_name = (body or {}).get('node')
    if not node_name:
        abort(400, description='node が必要です')
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    config = current_app.config['ENCODE_AUTO']
    fed = (config.get('federation') or {})
    if not any(n.get('name') == node_name and n.get('url')
               for n in (fed.get('remote_nodes') or [])):
        abort(400, description=f'連携ノード {node_name} が設定にありません')
    # 送っている最中にもう一度押されても二重に送らない
    try:
        st = json.loads(recording.get('transfer_state') or '{}')
    except (json.JSONDecodeError, TypeError):
        st = {}
    from logic.encode_pipeline.runner.transfer_retry import _TRANSFER_INFLIGHT_PHASES
    if isinstance(st, dict) and st.get('phase') in _TRANSFER_INFLIGHT_PHASES:
        return jsonify({'started': False, 'reason': 'busy', 'transfer_state': st}), 409

    # やり直しの時に意味が変わらないようにする。元がエンコード委譲
    # (encode_type='node:<この相手>')なら向こうでキューに載せる、そうでなければ
    # 転送だけ。body に encode を明示されていればそれに従う。
    try:
        _tei = json.loads(recording.get('to_encode_info') or '{}')
    except (json.JSONDecodeError, TypeError):
        _tei = {}
    from logic.encode_pipeline.runner.transfer import _node_encoder_name
    delegated = _node_encoder_name(_tei.get('encode_type', '')) == node_name
    want_encode = (body or {}).get('encode')
    do_encode = bool(delegated if want_encode is None else want_encode)

    def _transfer():
        from logic.encode_pipeline.runner.transfer import transfer_recording_to_node
        try:
            transfer_recording_to_node(db, rec_id, config, node_name, encode=do_encode)
        except Exception as e:
            logging.getLogger(__name__).error(
                'transfer_recording: rec=%d → %s failed: %s', rec_id, node_name, e)
    threading.Thread(target=_transfer, daemon=True).start()
    return jsonify({'started': True, 'node': node_name, 'encode': do_encode})
