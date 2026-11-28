"""予約・自動予約(EPG)・プログラム予約"""

from datetime import datetime
import logging
from typing import Optional
from read_tsprogram.program_info import normalize_text
from .common import (  # noqa: F401
    _REC_DEFAULTS,
    _normalize_bool_flags,
    _rec_setting_to_post_params,
)
from .rule_reserves import _RuleReservesMixin

logger = logging.getLogger('clients.edcb_api')


class _ReservesMixin(_RuleReservesMixin):
    """EDCBClient の一部（予約・自動予約(EPG)・プログラム予約）。"""

    # -------------------------------------------------------------------------
    # 予約
    # -------------------------------------------------------------------------

    def enum_reserve_info(self, *, index: int = 0, count: int = 10000) -> list:
        """予約一覧取得"""
        items = self._get("EnumReserveInfo", {"index": index, "count": count})
        for r in items:
            r["title"]       = normalize_text(r.get("title", ""))
            r["stationName"] = normalize_text(r.get("stationName", ""))
        return items

    def enum_tuner_reserve_info(self) -> list:
        """チューナー別予約情報取得"""
        return self._get("EnumTunerReserveInfo")

    def _default_preset_params(self) -> dict:
        """EDCB のデフォルトプリセット(id=0)の recSetting を SetReserve の POST フィールド形式で返す。
        取得失敗時は _REC_DEFAULTS にフォールバックする。
        """
        try:
            preset = next((p for p in self.enum_rec_preset() if p.get('id') == 0), None)
        except Exception:
            preset = None
        if not preset:
            return dict(_REC_DEFAULTS)
        return _rec_setting_to_post_params(preset.get('recSetting', {}))

    def add_reserve(self, id: str, **rec_settings) -> dict:
        """EPGイベントから予約追加。
        id: 'ONID-TSID-SID-EID'
        rec_settings: recMode, priority 等（省略時は EDCB デフォルトプリセットを使用）
        """
        onid, tsid, sid, eid = id.split('-')
        ctok = self._get_csrf_token('setreserve')
        params = _normalize_bool_flags({**self._default_preset_params(), **rec_settings})
        return self._post("SetReserve", data={
            "add": 1, "ctok": ctok,
            "onid": onid, "tsid": tsid, "sid": sid, "eid": eid,
            **params,
        })

    def add_reserve_manual(
        self,
        startdate: str,
        starttime: str,
        endtime: str,
        service: str,
        title: Optional[str] = None,
        **rec_settings,
    ) -> dict:
        """manu_add 経由で一回限りの手動予約を作成する。
        startdate: '2026-04-24'
        starttime / endtime: '20:00:00'
        service: 'ONID-TSID-SID'

        1. manu_add ルール作成 → EDCB が予約を自動生成
        2. ルールだけ削除（予約は残す）
        3. 対象日以外の予約は削除
        """
        # 既存予約IDをスナップショット
        before_ids = {r['reserveID'] for r in self.enum_reserve_info()}

        # start_date から曜日を算出 (bit0=日, bit1=月, ..., bit6=土)
        dt = datetime.strptime(startdate, '%Y-%m-%d')
        wday = dt.weekday()  # 0=月, 1=火, ..., 6=日
        # Python weekday → EDCB bit: 月=bit1, 火=bit2, ..., 日=bit0
        edcb_bit = (wday + 1) % 7
        day_of_week_flag = 1 << edcb_bit

        # manu_add ルール作成 → EDCB が予約を自動生成
        self.add_manu_add(
            start_time=starttime, end_time=endtime,
            service_id=service, day_of_week_flag=day_of_week_flag,
            title=title or '', **rec_settings,
        )

        # 作成した manu_add ルールを特定して削除（予約は残る）
        onid, tsid, sid = (int(x) for x in service.split('-'))
        parts = starttime.split(':')
        target_sod = int(parts[0]) * 3600 + int(parts[1]) * 60 + (int(parts[2]) if len(parts) > 2 else 0)

        for rule in self.enum_manu_add():
            if (rule.get('onid') == onid and rule.get('tsid') == tsid and
                    rule.get('sid') == sid and rule.get('startTime') == target_sod and
                    rule.get('title') == (title or '')):
                self.del_manu_add(rule['dataID'])
                break

        # 新規予約を特定（差分）
        after = self.enum_reserve_info()
        new_reserves = [r for r in after if r['reserveID'] not in before_ids]

        # 対象日の予約のみ残し、他の週の予約は削除
        target_reserve = None
        for r in new_reserves:
            st = r.get('startTime', '')
            if st and st.startswith(startdate):
                target_reserve = r
            else:
                try:
                    self.del_reserve(r['reserveID'])
                except Exception as e:
                    logger.warning('add_reserve_manual: 余分にできた予約 %s の削除に失敗: %s',
                                   r.get('reserveID'), e)

        if target_reserve is None:
            raise RuntimeError('予約の作成に失敗しました')

        return {'success': '予約を追加しました', 'reserveID': target_reserve['reserveID']}

    def change_reserve(self, reserve_id: int, **rec_settings) -> dict:
        """予約変更。rec_settings で変更したい項目のみ指定。
        SetReserve(change) は POST から recSetting を全再構築するため、既存予約の設定を
        ベースにして部分上書きする（スキップ解除等で録画フォルダ/プラグインが消えるのを防ぐ）。
        """
        ctok = self._get_csrf_token('setreserve')
        existing = next((r for r in self.enum_reserve_info() if r.get('reserveID') == reserve_id), None)
        base = _rec_setting_to_post_params(existing.get('recSetting', {})) if existing else dict(_REC_DEFAULTS)
        params = _normalize_bool_flags({**base, **rec_settings})
        return self._post("SetReserve", params={"id": reserve_id}, data={"change": 1, "ctok": ctok, **params})

    def del_reserve(self, reserve_id: int) -> dict:
        """予約削除"""
        ctok = self._get_csrf_token('setreserve')
        return self._post("SetReserve", params={"id": reserve_id}, data={"del": 1, "ctok": ctok})

    def oneclick_reserve(self, id: str) -> dict:
        """ワンクリック予約（デフォルトプリセット使用）。
        id: 'ONID-TSID-SID-EID'
        """
        return self._get("SetReserve", {"oneclick": 1, "id": id})

    # -------------------------------------------------------------------------
    # 自動予約
    # -------------------------------------------------------------------------


