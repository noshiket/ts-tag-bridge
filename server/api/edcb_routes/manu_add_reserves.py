"""プログラム予約を変えた時に、古い時刻・曜日で入っていた予約をスキップにする"""

from datetime import datetime, timedelta
from typing import Optional
from quart import current_app


_MANU_ADD_COMMENT = 'プログラム自動予約'


def _reserve_sod(rsv: dict) -> Optional[int]:
    """予約の開始時刻を「その日の秒数」で返す（manu_add ルールの startTime と比較する用）。"""
    try:
        dt = datetime.fromisoformat(rsv.get('startTime') or '')
    except ValueError:
        return None
    return dt.hour * 3600 + dt.minute * 60 + dt.second


def _manu_add_sod(rule: dict) -> Optional[int]:
    """manu_add ルールの startTime（その日の秒数）。25:30 のような24時超え表記も畳む。"""
    sod = rule.get('startTime')
    return sod % 86400 if isinstance(sod, int) and sod >= 0 else None


def _is_manu_add_reserve_of(rsv: dict, rule: dict) -> bool:
    """予約がそのプログラム予約ルール由来か（comment・局・title・開始時分秒で照合）。"""
    return (rsv.get('comment') == _MANU_ADD_COMMENT and
            rsv.get('onid') == rule.get('onid') and
            rsv.get('tsid') == rule.get('tsid') and
            rsv.get('sid') == rule.get('sid') and
            rsv.get('title') == rule.get('title') and
            _reserve_sod(rsv) is not None and
            _reserve_sod(rsv) == _manu_add_sod(rule))


def _dow_covered(rsv: dict, day_of_week_flag: int) -> bool:
    """予約の開始曜日が dayOfWeekFlag(bit0=日〜bit6=土) に含まれるか。"""
    try:
        dt = datetime.fromisoformat(rsv.get('startTime') or '')
    except ValueError:
        return False
    return bool((day_of_week_flag or 0) >> ((dt.weekday() + 1) % 7) & 1)


def _manu_add_params_to_rule(params: dict) -> dict:
    """parse_manu_add_request の結果を enum_manu_add と同じ形（照合用）に直す。"""
    onid, tsid, sid = (int(x) for x in (params.get('service_id') or '0-0-0').split('-'))
    parts = (params.get('start_time') or '0:0:0').split(':')
    sod = (int(parts[0]) * 3600 + int(parts[1]) * 60 +
           (int(parts[2]) if len(parts) > 2 else 0)) % 86400
    return {'onid': onid, 'tsid': tsid, 'sid': sid,
            'title': params.get('title') or '', 'startTime': sod,
            'dayOfWeekFlag': params.get('day_of_week_flag', 127)}


def _manu_add_other_rule_for(all_rules: list, rule_id: int, rsv: dict) -> Optional[dict]:
    """その予約と同じ枠（局・開始時分秒・曜日）を対象にしている別のプログラム予約ルール。"""
    return next((r for r in all_rules
                 if r.get('dataID') != rule_id
                 and r.get('onid') == rsv.get('onid')
                 and r.get('tsid') == rsv.get('tsid')
                 and r.get('sid') == rsv.get('sid')
                 and _manu_add_sod(r) == _reserve_sod(rsv)
                 and _dow_covered(rsv, r.get('dayOfWeekFlag', 0))), None)


def _skip_stale_manu_add_reserves(client, rule_id: int, old_rule: dict,
                                  new_params: dict, all_rules: list) -> None:
    """プログラム予約ルールの変更で条件から外れた旧予約をスキップ(recEnabled=0)する。

    auto_add と同じく EDCB はルール変更時に旧予約を回収しない（実測: start_time 変更でも
    day_of_week_flag 変更でも旧予約が残る）。
    manu_add は EPG 検索が要らず、局・title・開始時分秒・曜日だけで判定できる。

    触らないもの:
      - 他のプログラム予約ルールが同じ枠（局・開始時分秒・曜日）を対象にしている予約
      - 同じ局・title・開始時分秒のルールが他にもある場合は全予約（由来を区別できない）
      - 既にスキップされている予約、開始済み・開始間近の予約
    """
    old_sod = _manu_add_sod(old_rule)
    if old_sod is None:
        return
    ident = (old_rule.get('onid'), old_rule.get('tsid'), old_rule.get('sid'),
             old_rule.get('title'), old_sod)
    dup = [r for r in all_rules if r.get('dataID') != rule_id
           and (r.get('onid'), r.get('tsid'), r.get('sid'), r.get('title'),
                _manu_add_sod(r)) == ident]
    if dup:
        current_app.logger.info(
            'manu_add %d: 同じ局・title・開始時刻のルールが他に%d件あるため旧予約の突き合わせを省略',
            rule_id, len(dup))
        return

    new_rule = _manu_add_params_to_rule(new_params)
    cutoff = (datetime.now() + timedelta(minutes=15)).isoformat()
    skipped = 0
    for rsv in client.enum_reserve_info():
        if not _is_manu_add_reserve_of(rsv, old_rule):
            continue
        if not (rsv.get('recSetting') or {}).get('recEnabled', True):
            continue
        start = rsv.get('startTime') or ''
        if not start or start <= cutoff:
            continue
        if (_is_manu_add_reserve_of(rsv, new_rule)
                and _dow_covered(rsv, new_rule['dayOfWeekFlag'])):
            continue  # 変更後の条件にまだ合う
        other = _manu_add_other_rule_for(all_rules, rule_id, rsv)
        if other:
            current_app.logger.info('manu_add %d: 予約 %d "%s" は他ルール(%s)の対象のため残す',
                                    rule_id, rsv['reserveID'], rsv.get('title', ''),
                                    other.get('dataID'))
            continue
        try:
            client.change_reserve(rsv['reserveID'], recEnabled=0)
            skipped += 1
            current_app.logger.info('manu_add %d: 条件から外れた予約 %d "%s" をスキップ',
                                    rule_id, rsv['reserveID'], rsv.get('title', ''))
        except Exception as e:
            current_app.logger.warning('manu_add %d: 予約 %s のスキップ失敗: %s',
                                       rule_id, rsv.get('reserveID'), e)
    if skipped:
        current_app.logger.info('manu_add %d: 旧条件の予約 %d件をスキップしました', rule_id, skipped)
