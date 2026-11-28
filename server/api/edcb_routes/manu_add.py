"""プログラム予約（手動の繰り返し）と予約の一覧・チューナー"""

from quart import jsonify, current_app
from api import schemas
from api.routes.auth import bp
from api.routes.edcb_call import _call, _client  # noqa: F401
from . import reserve_guard
from api.routes.caches import _json  # noqa: F401
from .manu_add_reserves import _is_manu_add_reserve_of, _manu_add_other_rule_for, _skip_stale_manu_add_reserves


@bp.post('/manu_add')
async def add_manu_add():
    """EDCB にプログラム予約（曜日・時刻で決める予約）のルールを足す。"""
    body = await _json()
    params = schemas.parse_manu_add_request(body)
    reserve_guard.check_manu_add(params)   # 局と有料の局（利用者ごとの権限）
    result = _call(_client().add_manu_add, **params)
    return jsonify(result), 201


@bp.patch('/manu_add/<int:rule_id>')
async def update_manu_add(rule_id):
    """プログラム予約ルールの更新。変更後は条件から外れた旧予約をスキップする
    （EDCBは回収しない）。"""
    body = await _json()
    client = _client()
    params = schemas.parse_manu_add_request(body)
    reserve_guard.check_manu_add(params)
    rules = _call(client.enum_manu_add)
    current = next((r for r in rules if r.get('dataID') == rule_id), None)
    result = _call(client.change_manu_add, rule_id, **params)
    if current is not None:
        try:
            _skip_stale_manu_add_reserves(client, rule_id, current, params, rules)
        except Exception as e:
            # 突き合わせの失敗でルール変更自体を失敗にしない（旧予約が残るだけ）
            current_app.logger.warning('manu_add %d: 旧予約の突き合わせ失敗: %s', rule_id, e)
    return jsonify(result)


@bp.delete('/manu_add/<int:rule_id>')
def delete_manu_add(rule_id):
    """プログラム予約のルールを消し、そのルールで入った予約も消す（他のルールも対象にしている予約は残す）。"""
    # 処理順: 対象予約をスキップ → ルール削除 → 対象予約を削除
    # 一致条件は _is_manu_add_reserve_of（comment・局・title・開始時分秒）
    client = _client()
    target_ids = []
    try:
        rules = client.enum_manu_add()
        rule = next((r for r in rules if r.get('dataID') == rule_id), None)
        if rule:
            for rsv in client.enum_reserve_info():
                if not _is_manu_add_reserve_of(rsv, rule):
                    continue
                # 他のプログラム予約ルールが同じ枠を対象にしている予約は消さない
                other = _manu_add_other_rule_for(rules, rule_id, rsv)
                if other:
                    current_app.logger.info('manu_add %d: 予約 %d "%s" は他ルール(%s)の対象のため残す',
                                            rule_id, rsv['reserveID'], rsv.get('title', ''),
                                            other.get('dataID'))
                    continue
                target_ids.append(rsv['reserveID'])
                try:
                    client.change_reserve(rsv['reserveID'], recEnabled=0)
                except Exception as e:
                    # 無視してルール削除を続ける。予約が残るので理由は残す
                    current_app.logger.warning('manu_add %d 削除: 予約 %s の録画無効化に失敗: %s',
                                               rule_id, rsv['reserveID'], e)
    except Exception as e:
        # スキップ処理の失敗でルール削除を止めない
        current_app.logger.warning('manu_add %d 削除: 対象予約の洗い出しに失敗: %s', rule_id, e)

    result = _call(client.del_manu_add, rule_id)

    # ルール削除後に対象予約を削除
    for rid in target_ids:
        try:
            client.del_reserve(rid)
        except Exception as e:
            # 無視して続ける。EDCB に予約が残るので理由は残す
            current_app.logger.warning('manu_add %d 削除: 予約 %s の削除に失敗: %s', rule_id, rid, e)

    return jsonify(result)


