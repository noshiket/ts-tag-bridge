"""録画の一覧・更新・削除・付加情報"""

from quart import jsonify, current_app, abort
from api import schemas
from api.routes.auth import bp, perm
from api.routes.edcb_call import _call, _client  # noqa: F401
from api.routes.caches import _json


def _sid_tsid_map():
    """(onid, sid) → tsid。tsid列を持たないテーブル(encodings)の権限判定に使う。"""
    m = current_app.config.get('_onid_sid_tsid')
    if m is None:
        try:
            m = {(x['onid'], x['sid']): x['tsid'] for x in _client().enum_service()}
        except Exception:
            m = {}
        current_app.config['_onid_sid_tsid'] = m
    return m


def _perm_filter_encodings(items):
    """encodings は tsid を持たないので、サービス一覧から補って局で絞る。"""
    tmap = _sid_tsid_map()
    return perm().filter_items(
        items, get_service=lambda e: (e.get('onid'),
                                      tmap.get((e.get('onid'), e.get('sid'))), e.get('sid')))


@bp.get('/encode/options')
def encode_options():
    """録画詳細画面のエンコード設定UI(サーバー選択・出力先候補等)向けの読み取り専用サブセット。
    /api/configはシークレットを含む全設定を返すため管理者専用でfederation開放できないが、
    federationピアの録画詳細を操作する際にもこの情報が必要なので、安全な部分だけを
    切り出して_FED_ALLOWEDで開放できるようにした(url/tcp_url/volumes等の内部ネットワーク
    情報は含めない)。"""
    config = current_app.config['ENCODE_AUTO']
    lp = (config.get('federation') or {}).get('library_peer') or {}
    # エンコーダーアドオン(server/addon/ の target='encoder')。encode_type='addon:<name>' で選ぶ
    try:
        from logic.addons import addon_runner
        encoder_addons = [a for a in addon_runner.list_addons(target='encoder', only_enabled=True)
                          if not a.get('error')]
    except Exception as e:
        current_app.logger.warning('encode_options: encoder addon一覧の取得に失敗: %s', e)
        encoder_addons = []
    return jsonify({
        'edcb_servers': [{'name': s.get('name'), 'encode': s.get('encode') or []}
                         for s in (config.get('edcb_servers') or [])],
        'amatsukaze_servers': [{'name': s.get('name'), 'url': s.get('url'),
                                'encode_preset': s.get('encode_preset') or []}
                               for s in (config.get('amatsukaze_servers') or [])],
        'encode_dir_list': config.get('encode_dir_list') or [],
        'library_peer_name': (lp.get('name') or '連携先') if lp.get('url') else None,
        'encoder_addons': encoder_addons,
        # ノード委譲エンコード先(encode_type='node:<name>' で選ぶ。録画転送型)
        'remote_nodes': [{'name': n['name']}
                         for n in (config.get('federation') or {}).get('remote_nodes') or []
                         if n.get('url') and n.get('name')],
    })


# ---------------------------------------------------------------------------
# 録画結果
# ---------------------------------------------------------------------------

@bp.get('/recordings')
def list_recordings():
    """EDCB の録画済みの一覧（利用者の権限で見られる物だけ）。"""
    items, idx, batch = [], 0, 200
    while True:
        chunk = _call(_client().enum_rec_info, index=idx, count=batch)
        if isinstance(chunk, dict):
            chunk = [chunk]
        if not chunk:
            break
        items.extend(chunk)
        if len(chunk) < batch:
            break
        idx += batch
    return jsonify(perm().filter_items([schemas.rec_info_to_response(r) for r in items]))


@bp.patch('/recordings/<int:rec_id>')
async def update_recording(rec_id):
    """protectFlag 変更 / ファイルパス変更"""
    body = await _json()
    if 'protect_flag' in body:
        result = _call(_client().protect_rec_info, rec_id, bool(body['protect_flag']))
    elif 'rec_file_path' in body:
        result = _call(_client().rename_rec_info, rec_id, body['rec_file_path'])
    else:
        abort(400, description='protect_flag または rec_file_path が必要です')
    return jsonify(result)


