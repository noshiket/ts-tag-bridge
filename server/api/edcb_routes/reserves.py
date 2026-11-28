"""予約と EPG キーワード自動予約（/api/reserves/*, /api/auto_add/*）"""

from quart import (
    jsonify,
    current_app,
    abort,
)
from api import schemas
from api.routes.auth import bp  # noqa: F401
from api.routes.edcb_call import _call, _client  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from .auto_add_reserves import _auto_add_comment, _covered_by_other_rules, _skip_stale_auto_add_reserves
from . import reserve_guard


@bp.post('/reserves')
async def add_reserve():
    """予約を足す。番組表の番組（EPG 予約）か、時刻を決めた予約（手動予約）のどちらか。"""
    body = await _json()
    kind, kwargs = schemas.parse_reserve_request(body)
    reserve_guard.check_reserve(_client(), kind, kwargs)   # 局と有料の番組（利用者ごとの権限）
    if kind == 'epg':
        result = _call(_client().add_reserve, **kwargs)
    else:
        result = _call(_client().add_reserve_manual, **kwargs)
    return jsonify(result), 201


@bp.patch('/reserves/<int:reserve_id>')
async def update_reserve(reserve_id):
    """予約の設定（録画の設定など）を変える。"""
    body = await _json()
    kwargs = schemas.parse_reserve_update(body)
    result = _call(_client().change_reserve, reserve_id, **kwargs)
    return jsonify(result)


@bp.delete('/reserves/<int:reserve_id>')
def delete_reserve(reserve_id):
    """予約を消す。"""
    result = _call(_client().del_reserve, reserve_id)
    return jsonify(result)


# ---------------------------------------------------------------------------
# EPGキーワード自動予約
# ---------------------------------------------------------------------------

@bp.get('/auto_add')
def list_auto_add():
    """EDCB のキーワード自動予約のルールの一覧。"""
    items = _call(_client().enum_auto_add)
    return jsonify([schemas.auto_add_to_response(a) for a in items])


def _ensure_service_list(client, params: dict) -> dict:
    """serviceList が空なら全サービスで埋める。

    番組検索は「放送局未指定＝全局」だが、EPG自動予約は serviceList が空のまま保存でき、
    どの局にも一致しないルールになる上に EMWUI の EPG自動予約一覧が読めなくなる
    （実機で確認済み）。UI 側でも新規作成時に全局を選択済みにしているが、
    どの経路から来ても壊れた状態を作らないようここでも埋める。
    """
    if params.get('serviceList'):
        return params
    try:
        svcs = client.enum_service() or []
        all_svc = sorted({(x['onid'], x['tsid'], x['sid']) for x in svcs
                          if x.get('service_type') == 1})
        if all_svc:
            params = dict(params)
            params['serviceList'] = [f'{o}-{t}-{s}' for o, t, s in all_svc]
            current_app.logger.info('auto_add: 放送局未指定のため全%d局で登録します', len(all_svc))
    except Exception as e:
        current_app.logger.warning('auto_add: 全局の取得に失敗(未指定のまま送ります): %s', e)
    return params


@bp.post('/auto_add')
async def add_auto_add():
    """キーワード自動予約のルールを足す。作ったルールの番号を id で返す。"""
    body = await _json()
    client = _client()
    params = reserve_guard.restrict_auto_add(_ensure_service_list(client, schemas.parse_auto_add_request(body)))
    result = _call(client.add_auto_add, **params)
    # EDCB の SetAutoAdd は作ったルールの番号を返さない。画面はそれを使って
    # ルールに付く設定（番組表アドオンの局の選択など）を保存するので、作った直後に
    # 一覧を引き、いちばん新しい番号（EDCB は連番で振る）を添える
    try:
        ids = [r.get('dataID') for r in (client.enum_auto_add() or []) if r.get('dataID') is not None]
        if ids and isinstance(result, dict):
            result = {**result, 'id': max(ids)}
    except Exception as e:
        current_app.logger.warning('auto_add: 作ったルールの番号を引けませんでした: %s', e)
    return jsonify(result), 201


@bp.patch('/auto_add/<int:rule_id>')
async def update_auto_add(rule_id):
    """自動予約ルールの部分更新。SetAutoAddは全置換のため、既存ルールを
    EDCBから取得してベースにし、送られたフィールドだけ上書きして送る
    （従来は素通しで、部分bodyだと未送信フィールドがEDCB既定値へ戻っていた）。
    変更後は、条件から外れた旧予約をスキップする（EDCBは回収しない）。"""
    body = await _json()
    client = _client()
    rules = _call(client.enum_auto_add)
    current = next((r for r in rules if r.get('dataID') == rule_id), None)
    if current is None:
        abort(404, description='自動予約ルールが見つかりません')
    params = reserve_guard.restrict_auto_add(_ensure_service_list(client, schemas.merge_auto_add_patch(current, body)))
    result = _call(client.change_auto_add, rule_id, **params)
    try:
        _skip_stale_auto_add_reserves(client, rule_id, current, rules)
    except Exception as e:
        # 突き合わせの失敗でルール変更自体を失敗にしない（旧予約が残るだけ）
        current_app.logger.warning('auto_add %d: 旧予約の突き合わせ失敗: %s', rule_id, e)
    return jsonify(result)


@bp.delete('/auto_add/<int:rule_id>')
def delete_auto_add(rule_id):
    """キーワード自動予約のルールを消し、そのルールで入った予約も消す。"""
    client = _client()
    target_ids = []
    try:
        rules = client.enum_auto_add()
        rule = next((r for r in rules if r.get('dataID') == rule_id), None)
        if rule:
            si = rule.get('searchInfo', {})
            expected_comment = _auto_add_comment(si.get('andKey', ''))
            service_list = si.get('serviceList', [])

            candidates = {}
            for rsv in client.enum_reserve_info():
                if rsv.get('comment') != expected_comment:
                    continue
                # service_listが空でない場合はサービスも照合
                if service_list:
                    if not any(s.get('onid') == rsv.get('onid') and
                               s.get('tsid') == rsv.get('tsid') and
                               s.get('sid') == rsv.get('sid') for s in service_list):
                        continue
                candidates[(rsv.get('onid'), rsv.get('tsid'),
                            rsv.get('sid'), rsv.get('eid'))] = rsv
            # 他の有効なルールでも対象になっている予約は消さない（PATCH と同じ判定）
            covered = _covered_by_other_rules(client, rule_id, rules, set(candidates)) \
                if candidates else set()
            for key, rsv in candidates.items():
                if key in covered:
                    current_app.logger.info('auto_add %d: 予約 %d "%s" は他ルールの対象のため残す',
                                            rule_id, rsv['reserveID'], rsv.get('title', ''))
                    continue
                target_ids.append(rsv['reserveID'])
                try:
                    client.change_reserve(rsv['reserveID'], recEnabled=0)
                except Exception as e:
                    # 無視してルール削除を続ける。予約が残るので理由は残す
                    current_app.logger.warning('auto_add %d 削除: 予約 %s の録画無効化に失敗: %s',
                                               rule_id, rsv['reserveID'], e)
    except Exception as e:
        # スキップ処理の失敗でルール削除を止めない
        current_app.logger.warning('auto_add %d 削除: 対象予約の洗い出しに失敗: %s', rule_id, e)

    result = _call(client.del_auto_add, rule_id)

    # ルール削除後に対象予約を削除
    for rid in target_ids:
        try:
            client.del_reserve(rid)
        except Exception as e:
            # 無視して続ける。EDCB に予約が残るので理由は残す
            current_app.logger.warning('auto_add %d 削除: 予約 %s の削除に失敗: %s', rule_id, rid, e)

    return jsonify(result)


# ---------------------------------------------------------------------------
# プログラム予約（手動繰り返し）
# ---------------------------------------------------------------------------

@bp.get('/manu_add')
def list_manu_add():
    """EDCB のプログラム予約（曜日・時刻で決める予約）のルールの一覧。"""
    items = _call(_client().enum_manu_add)
    return jsonify([schemas.manu_add_to_response(m) for m in items])
