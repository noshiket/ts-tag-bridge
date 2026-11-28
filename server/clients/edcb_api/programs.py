"""番組・予約を Program の形にして返す"""

from datetime import datetime
from read_tsprogram.program_info import ProgramInfo


class _ProgramsMixin:
    """EDCBClient の一部（番組・予約を Program の形にして返す）。"""

    def _event_to_program(self, e: dict) -> ProgramInfo:
        """EnumEventInfo / SearchEvent のレスポンス要素を ProgramInfo に変換する"""
        self._load_service_map()
        short = e.get("shortInfo") or {}
        ext   = e.get("extInfo") or {}

        content_list = e.get("contentInfoList") or []
        if content_list:
            cn = content_list[0].get("component_type_name", {})
            genre = "/".join(filter(None, [cn.get("nibble1", ""), cn.get("nibble2", "")])) if isinstance(cn, dict) else str(cn)
        else:
            genre = ""

        component  = e.get("componentInfo") or {}
        audio_list = e.get("audioInfoList") or []

        return ProgramInfo(
            title         = short.get("event_name", ""),
            service_name  = self._service_map.get((e["onid"], e["tsid"], e["sid"]), ""),
            sid           = e["sid"],
            event_id      = e["eid"],
            start_time    = datetime.fromisoformat(e["startTime"]),
            duration_min  = e.get("durationSecond", 0) // 60,
            description   = short.get("text_char", ""),
            extended_info = ext.get("text_char", ""),
            genre         = genre,
            free_ca       = bool(e["freeCAFlag"]) if "freeCAFlag" in e else None,
            video_info    = component.get("component_type_name", ""),
            audio_info    = (audio_list[0].get("component_type_name", "") if audio_list else ""),
            onid          = e["onid"],
            tsid          = e["tsid"],
        )

    def _reserve_to_program(self, r: dict) -> ProgramInfo:
        """EnumReserveInfo のレスポンス要素を ProgramInfo に変換する"""
        return ProgramInfo(
            title        = r["title"],
            service_name = r["stationName"],
            sid          = r["sid"],
            event_id     = r["eid"],
            start_time   = datetime.fromisoformat(r["startTime"]),
            duration_min = r.get("durationSecond", 0) // 60,
            onid         = r["onid"],
            tsid         = r["tsid"],
        )

    def fetch_event_info(self, id: str, **kwargs) -> list[ProgramInfo]:
        """番組情報を取得して ProgramInfo リストで返し self.programs にも追加する。
        id: 'ONID-TSID-SID' / 'ONID-TSID-SID-EID'
        kwargs: basic, onair, index, count
        """
        programs = [self._event_to_program(e) for e in self.enum_event_info(id, **kwargs)]
        self.programs.extend(programs)
        return programs

    def fetch_search_event(self, **kwargs) -> list[ProgramInfo]:
        """番組検索結果を ProgramInfo リストで返し self.programs にも追加する。
        kwargs: andkey, notkey, network, days, genru, archive, index, count
        """
        programs = [self._event_to_program(e) for e in self.search_event(**kwargs)]
        self.programs.extend(programs)
        return programs

    def fetch_reserve_info(self) -> list[ProgramInfo]:
        """予約一覧を ProgramInfo リストで返し self.programs にも追加する"""
        programs = [self._reserve_to_program(r) for r in self.enum_reserve_info()]
        self.programs.extend(programs)
        return programs
