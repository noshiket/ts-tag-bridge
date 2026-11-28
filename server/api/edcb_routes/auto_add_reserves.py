"""EPG 自動予約を変えた時に、外れた予約をスキップにする（他のルールが拾う物は残す）"""

from datetime import datetime, timedelta
from quart import current_app
from api import schemas


def _auto_add_comment(and_key: str) -> str:
    """auto_add 由来の予約に付く comment。EDCBはコメント生成時にNFKC正規化する。"""
    import unicodedata

    key = unicodedata.normalize('NFKC', and_key or '')
    return f'EPG自動予約({key})' if key else 'EPG自動予約'


def _rule_matches(client, raw_rule: dict) -> set:
    """ルールの検索条件に一致する番組キー {(onid,tsid,sid,eid)} を EDCB の番組検索で得る。"""
    search_info = schemas.auto_add_to_response(raw_rule)['search_info']
    return {(e['onid'], e['tsid'], e['sid'], e['eid'])
            for e in client.search_event(**schemas.parse_search_request(search_info))}


def _covered_by_other_rules(client, rule_id: int, all_rules: list, keys: set) -> set:
    """keys のうち、他の有効な自動予約ルールでも対象になっている番組キーを返す。

    EDCBは同じ番組に予約を1件しか作らないため、AとBの両方に一致する番組の予約は
    先に登録した側（=comment）のものになる。A2が外れてもBが対象にしているなら
    その予約は必要なので、スキップ対象から除く。
    """
    covered = set()
    for raw in all_rules:
        if raw.get('dataID') == rule_id:
            continue
        resp = schemas.auto_add_to_response(raw)
        if resp['disable_flag']:
            continue
        svcs = (resp['search_info'].get('service_list') or [])
        rest = keys - covered
        # このルールの対象局に候補が1つも無ければ検索しない（1ルール1リクエスト）
        if svcs and not any((sv.get('onid'), sv.get('tsid'), sv.get('sid')) == k[:3]
                            for sv in svcs for k in rest):
            continue
        try:
            covered |= rest & _rule_matches(client, raw)
        except Exception as e:
            # 判定できないルールがあるときは安全側（=covered扱い）にして全体を諦める
            current_app.logger.warning(
                'auto_add %d: 他ルール %s の照合に失敗したため旧予約の突き合わせを中止: %s',
                rule_id, raw.get('dataID'), e)
            return set(keys)
        if not keys - covered:
            break
    return covered


def _skip_stale_auto_add_reserves(client, rule_id: int, old_raw: dict, all_rules: list) -> None:
    """ルール変更で条件から外れた旧予約をスキップ(recEnabled=0)する。

    EDCBはルール変更時に旧条件の予約を回収しない（実測: and_key変更でもserviceList
    変更でも旧予約が残る）。放置すると
    不要な録画がそのまま走るため、変更後の条件で番組検索し直し、もう一致しない
    予約を無効化する。削除まではしない（誤判定時にユーザーが戻せるように）。

    触らないもの:
      - 他の有効な自動予約ルールでも対象になっている番組（_covered_by_other_rules）
      - 同じ and_key のルールが他にもある場合は全予約（commentが同一でどちらの
        ルール由来か区別できず、他ルールの予約を巻き込むため何もしない）
      - 既にスキップされている予約（EDCB側/手動の判断を尊重）
      - 開始済み・開始間近の予約（EPG検索は未来番組しか返さないので「一致しない」
        と誤判定される。録画中の予約を止めないための安全側）

    プログラム予約(comment='プログラム自動予約')・手動予約は comment が違うので
    最初から候補に入らない。
    """
    old_comment = _auto_add_comment((old_raw.get('searchInfo') or {}).get('andKey', ''))
    dup = [r for r in all_rules if r.get('dataID') != rule_id
           and _auto_add_comment((r.get('searchInfo') or {}).get('andKey', '')) == old_comment]
    if dup:
        current_app.logger.info(
            'auto_add %d: 同じand_keyのルールが他に%d件あるため旧予約の突き合わせを省略',
            rule_id, len(dup))
        return

    # 番組検索は重いので、まず旧ルール由来の予約を絞ってから検索する
    old_services = (old_raw.get('searchInfo') or {}).get('serviceList') or []
    cutoff = (datetime.now() + timedelta(minutes=15)).isoformat()
    candidates = {}
    for rsv in client.enum_reserve_info():
        if rsv.get('comment') != old_comment:
            continue
        if old_services and not any(sv.get('onid') == rsv.get('onid') and
                                    sv.get('tsid') == rsv.get('tsid') and
                                    sv.get('sid') == rsv.get('sid') for sv in old_services):
            continue
        if not (rsv.get('recSetting') or {}).get('recEnabled', True):
            continue
        start = rsv.get('startTime') or ''
        if not start or start <= cutoff:
            continue
        candidates[(rsv.get('onid'), rsv.get('tsid'), rsv.get('sid'), rsv.get('eid'))] = rsv
    if not candidates:
        return

    new_raw = next((r for r in client.enum_auto_add() if r.get('dataID') == rule_id), None)
    if new_raw is None:
        return
    for key in _rule_matches(client, new_raw):
        candidates.pop(key, None)
    if not candidates:
        return

    covered = _covered_by_other_rules(client, rule_id, all_rules, set(candidates))
    skipped = 0
    for key, rsv in candidates.items():
        if key in covered:
            current_app.logger.info('auto_add %d: 予約 %d "%s" は他ルールの対象のため残す',
                                    rule_id, rsv['reserveID'], rsv.get('title', ''))
            continue
        try:
            client.change_reserve(rsv['reserveID'], recEnabled=0)
            skipped += 1
            current_app.logger.info('auto_add %d: 条件から外れた予約 %d "%s" をスキップ',
                                    rule_id, rsv['reserveID'], rsv.get('title', ''))
        except Exception as e:
            current_app.logger.warning('auto_add %d: 予約 %s のスキップ失敗: %s',
                                       rule_id, rsv.get('reserveID'), e)
    if skipped:
        current_app.logger.info('auto_add %d: 旧条件の予約 %d件をスキップしました', rule_id, skipped)
