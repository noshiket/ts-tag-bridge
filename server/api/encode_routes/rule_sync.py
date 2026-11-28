"""ルールと EPG・予約の同期、エンコードの一時停止の状態"""

from quart import jsonify, current_app, abort
from api import schemas
from read_tsprogram.program_info import normalize_extended_info
from api.routes.auth import bp, require_screen
from api.routes.edcb_call import _client
from api.routes.parser import _ruledb


@bp.post('/rules/<int:rule_id>/sync_epg')
def sync_epg_rule(rule_id):
    """EDCB から EPG メタ情報（説明・ジャンル・映像・音声）を再取得して更新する"""
    rule = _ruledb().get_rule(rule_id)
    if rule is None:
        abort(404, description='ルールが見つかりません')

    reserve_key = rule.get('reserve_key', '')
    parts = reserve_key.split('-')
    if len(parts) != 4:
        abort(400, description='reserve_key が不正です')

    onid, tsid, sid, eid = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
    try:
        events = _client().enum_event_info(f'{onid}-{tsid}-{sid}-{eid}', basic=0)
    except Exception as e:
        abort(502, description=str(e))

    if not events:
        abort(404, description='EPG イベントが見つかりません')

    ev = events[0]
    description   = (ev.get('shortInfo') or {}).get('text_char', '')
    extended_info = normalize_extended_info((ev.get('extInfo') or {}).get('text_char', ''))
    cont_list  = ev.get('contentInfoList') or []
    component  = ev.get('componentInfo') or {}
    audio_list = ev.get('audioInfoList') or []
    genre = ''
    if cont_list:
        cn = cont_list[0].get('component_type_name', {})
        genre = ' > '.join(filter(None, [cn.get('nibble1', ''), cn.get('nibble2', '')])) \
                if isinstance(cn, dict) else str(cn)
    video_info = str(component.get('component_type_name', ''))
    audio_info = str(audio_list[0].get('component_type_name', '')) if audio_list else ''

    _ruledb().update_rule(rule_id,
        original_description=description, original_extended_info=extended_info,
        genre=genre, video_info=video_info, audio_info=audio_info)
    return jsonify(schemas.rule_to_response(_ruledb().get_rule(rule_id)))


@bp.post('/rules/sync')
def sync_rules():
    """予約の同期の予約取得・DB登録を即時実行する。

    ワーカーのポーリング間隔を待たずに手動で予約確認と DB 登録を行う。
    新規登録件数を返す。
    """
    worker = current_app.config.get('WORKERS', {}).get('reserve_sync')
    if worker is None:
        abort(503, description='予約の同期 worker が起動していません')

    db = _ruledb()
    before = len(db.list_rules())
    worker._safe_tick()
    after = len(db.list_rules())

    return jsonify({
        'added': after - before,
        'total': after,
        'last_error': worker.last_error,
    })


@bp.post('/encode/sync')
def sync_encode():
    """録画の見張りの録画検出・TSスキャン・キュー登録を即時実行する。"""
    worker = current_app.config.get('WORKERS', {}).get('recording_watch')
    if worker is None:
        abort(503, description='録画の見張り worker が起動していません')

    db = _ruledb()
    before = len(db.list_recordings())
    worker._safe_tick()
    after = len(db.list_recordings())

    return jsonify({
        'added': after - before,
        'total': after,
        'last_error': worker.last_error,
    })


@bp.get('/encode/pause')
def get_encode_pause():
    """エンコードの停止状態を返す。"""
    require_screen('encode')
    from logic.encoding import encode_pause
    from api.encode_routes.recordings.listing import _perm_filter_encodings
    # 権限で見られない番組の、エンコード中と待ちの件数（一覧に出ないので、止まっている・待ちが無いと
    # 見えてしまうのを避ける）。分け方は画面と同じ（core の encodeStatus）
    live = [schemas.encoding_to_response(e) for e in _ruledb().list_encodings()
            if not e.get('error_message') and e.get('state') not in ('encode_end', 'encode_error')]
    shown = {id(e) for e in _perm_filter_encodings(live)}
    hidden = [e for e in live if id(e) not in shown]
    running = sum(1 for e in hidden if e.get('state') in ('encoding', 'encoded_analyze', 'file_copy'))
    return jsonify({'paused': encode_pause.is_paused(),
                    'hidden_running': running, 'hidden_queued': len(hidden) - running})
