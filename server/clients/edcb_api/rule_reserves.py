"""EDCBClient の一部（EPG 自動予約・プログラム予約）"""

from typing import Optional
from .common import _REC_DEFAULTS, _normalize_bool_flags


class _RuleReservesMixin:
    """EDCBClient の一部（EPG 自動予約・プログラム予約）"""

    def enum_auto_add(self) -> list:
        """EPGキーワード自動予約ルール一覧取得"""
        return self._get("EnumAutoAdd")

    def add_auto_add(self, **params) -> dict:
        """EPG自動予約ルール追加。
        params: andkey, notkey, network, genru 等の検索条件 + recMode, priority 等の録画設定
        録画設定の省略分は add_reserve と同様に EDCB デフォルトプリセット(id=0)で埋める
        （従来は最低限の _REC_DEFAULTS のみで、マージン/フォルダ/プラグイン等の
        プリセット値が反映されなかった）。
        """
        ctok = self._get_csrf_token('setautoadd')
        p = _normalize_bool_flags({**_REC_DEFAULTS, **self._default_preset_params(), **params})
        return self._post("SetAutoAdd", data={"addchg": 1, "ctok": ctok, **p})

    def change_auto_add(self, rule_id: int, **params) -> dict:
        """EPG自動予約ルール変更"""
        ctok = self._get_csrf_token('setautoadd')
        p = _normalize_bool_flags({**_REC_DEFAULTS, **params})
        return self._post("SetAutoAdd", params={"id": rule_id}, data={"addchg": 1, "ctok": ctok, **p})

    def del_auto_add(self, rule_id: int) -> dict:
        """EPG自動予約ルール削除"""
        ctok = self._get_csrf_token('setautoadd')
        return self._post("SetAutoAdd", params={"id": rule_id}, data={"del": 1, "ctok": ctok})

    def enum_manu_add(self) -> list:
        """プログラム予約（時刻指定繰り返し）ルール一覧取得"""
        return self._get("EnumManuAdd")

    def add_manu_add(
        self,
        start_time: str,
        end_time: str,
        service_id: str,
        day_of_week_flag: int = 127,
        title: Optional[str] = None,
        **rec_settings,
    ) -> dict:
        """プログラム予約ルール追加。
        start_time / end_time: 'HH:MM:SS'
        service_id: 'ONID-TSID-SID'
        day_of_week_flag: bit0=日〜bit6=土 (127=毎日)
        """
        ctok = self._get_csrf_token('setmanuadd')
        p = {**_REC_DEFAULTS, **rec_settings}
        # SetManuAdd の Lua は dayOfWeekFlag を直接受け付けない。
        # dayOfWeekFlag==0 のとき checkDayOfWeek1〜7 を読んでビルドするため個別に展開する。
        # bit0=日(i=1) 〜 bit6=土(i=7)
        dow = {f"checkDayOfWeek{i}": (day_of_week_flag >> (i - 1)) & 1 for i in range(1, 8)}
        return self._post("SetManuAdd", data={
            "addchg": 1, "ctok": ctok,
            "startTime": start_time, "endTime": end_time,
            "serviceID": service_id,
            "title": title,
            **dow, **p,
        })

    def change_manu_add(
        self,
        rule_id: int,
        start_time: str,
        end_time: str,
        service_id: str,
        day_of_week_flag: int = 127,
        title: Optional[str] = None,
        **rec_settings,
    ) -> dict:
        """プログラム予約ルール変更（AddOrChgManuAdd に id を渡す）。
        引数は add_manu_add と同じ。
        """
        ctok = self._get_csrf_token('setmanuadd')
        p = {**_REC_DEFAULTS, **rec_settings}
        dow = {f"checkDayOfWeek{i}": (day_of_week_flag >> (i - 1)) & 1 for i in range(1, 8)}  # add_manu_add 参照
        return self._post("SetManuAdd", params={"id": rule_id}, data={
            "addchg": 1, "ctok": ctok,
            "startTime": start_time, "endTime": end_time,
            "serviceID": service_id,
            "title": title,
            **dow, **p,
        })

    def del_manu_add(self, rule_id: int) -> dict:
        """プログラム予約ルール削除"""
        ctok = self._get_csrf_token('setmanuadd')
        return self._post("SetManuAdd", params={"id": rule_id}, data={"del": 1, "ctok": ctok})
