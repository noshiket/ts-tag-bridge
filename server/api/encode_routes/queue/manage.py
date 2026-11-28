"""一時停止・一覧・やり直し・優先度・転送"""

from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api import schemas
from api.routes.auth import bp, require_screen  # noqa: F401
from api.routes.media import _amz  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from ..recordings.listing import _perm_filter_encodings  # noqa: F401


@bp.post('/encode/pause')
async def set_encode_pause():
    """エンコードを停止/再開する。body: {paused: bool}

    停止しても実行中のエンコードは中断しない（中断すると成果物が中途半端になるため）。
    実行中の1本が終わったら、以降は待機のまま新しく始めなくなる。
    """
    require_screen('encode')   # 書き込み権限(can_write)は非GET共通の before_request で判定
    from logic.encoding import encode_pause
    body = await _json()
    return jsonify({'paused': encode_pause.set_paused(bool(body.get('paused')))})


# ---------------------------------------------------------------------------
# recordings API（Phase 2）
# ---------------------------------------------------------------------------

@bp.get('/encode/recordings')
def list_encode_recordings():
    """エンコードジョブ一覧（encodings テーブル）。?state= でフィルタ可。"""
    require_screen('encode')
    import json as _j
    state = request.args.get('state')
    encs = _ruledb().list_encodings(state=state)

    # Amatsukaze 進捗注入（encoding 状態のみ）— コンソール出力から取得
    active = [e for e in encs if e.get('state') == 'encoding']
    if active:
        import re
        _prog_re = re.compile(r'\[(\d+\.?\d*)%\]')
        amz = current_app.config.get('AMATSUKAZE_CLIENT')
        if amz:
            for e in active:
                try:
                    ei = _j.loads(e.get('encode_info') or '{}')
                    iid = ei.get('amz_item_id')
                    if not iid:
                        continue
                    console = amz.get_console(task_id=iid)
                    lines = console.get('lines') or []
                    for line in reversed(lines):
                        text = line.get('text', '') if isinstance(line, dict) else str(line)
                        m = _prog_re.search(text)
                        if m:
                            e['progress'] = float(m.group(1)) / 100.0
                            break
                except Exception:
                    pass

    # 録画のエンコードではない仕事（動画への変換など）は recording_id を持たない
    # ので、録画を軸にしたこの一覧には並ばない。別立てで返して画面に出す。
    return jsonify(_perm_filter_encodings(
        [schemas.encoding_to_response(e) for e in encs
         if (e.get('job_kind') or '') != 'video_addon']))


@bp.get('/encode/addon_jobs')
def list_encode_addon_jobs():
    """エンコードキューに積んだアドオンの仕事（動画への変換など）。

    録画のエンコードと同じ行列(encodings)に入れているが、recording_id を
    持たないため /encode/recordings には並ばない。画面では別のまとまりとして出す。
    """
    require_screen('encode')
    rows = _ruledb().list_video_addon_jobs()
    out = []
    for r in rows:
        out.append({
            'encId': r['id'],
            'addon': r.get('addon_name'),
            'videoId': r.get('video_id'),
            'title': r.get('title') or '',
            'folder': r.get('folder') or '',
            'state': r.get('state'),
            'priority': r.get('priority') if r.get('priority') is not None else 3,
            'progress': r.get('progress') or 0,
            'errorMessage': r.get('error_message') or '',
            'createdAt': r.get('created_at'),
            'updatedAt': r.get('updated_at'),
        })
    return jsonify(out)


@bp.get('/encode/encodings/<int:enc_id>/console')
def get_encoding_console(enc_id):
    """Amatsukaze のコンソール出力（最新全行）を返す。
    アドオンエンコーダーの場合は Amatsukaze を使わないため addon_log を返す。"""
    import json as _j
    enc = _ruledb().get_encoding(enc_id)
    if enc is None:
        abort(404, description='encoding not found')
    ei = _j.loads(enc.get('encode_info') or '{}')
    addon_log = ei.get('addon_log')
    if addon_log:
        return jsonify({'lines': list(addon_log)})
    item_id = ei.get('amz_item_id')
    if not item_id:
        return jsonify({'lines': []})
    try:
        result = _amz().get_console(task_id=item_id)
        raw = result.get('lines') or []
        lines = [ln.get('text', '') if isinstance(ln, dict) else str(ln) for ln in raw]
        return jsonify({'lines': lines})
    except Exception as ex:
        return jsonify({'lines': [], 'error': str(ex)})


@bp.post('/encode/recordings/<int:rec_id>/skip_encode')
def skip_encode(rec_id):
    """録画のエンコードをスキップし、全 encodings を encode_end にする。"""
    db = _ruledb()
    rec = db.get_recording(rec_id)
    if rec is None:
        abort(404, description='recording not found')
    encodings = db.get_encodings(rec_id)
    for enc in encodings:
        db.update_encoding(enc['id'], state='encode_end', error_message=None)
    db.update_recording(rec_id, state='encode_finish')
    return jsonify({'status': 'skipped', 'rec_id': rec_id, 'skipped_count': len(encodings)})


@bp.get('/rules/<int:rule_id>/recordings')
def list_rule_recordings(rule_id):
    """番組に紐付く録画ファイル一覧。"""
    if _ruledb().get_rule(rule_id) is None:
        abort(404, description='ルールが見つかりません')
    recs = _ruledb().get_recordings(rule_id)
    return jsonify([schemas.recording_to_response(r) for r in recs])


