
class EDCBMockHandler:
    """EDCB API のモックハンドラー。
    base_url が 'demo' の場合にダミーレスポンスを返す。
    """

    def __init__(self):
        self.services = [
            {
                "ts_name": "",
                "service_name": "ＢＳあさぎ１",
                "service_type": 1,
                "tsid": 16400,
                "service_provider_name": "ＢＳあさぎ",
                "sid": 151,
                "remote_control_key_id": 5,
                "network_name": "BS Digital",
                "partialReceptionFlag": False,
                "onid": 4
            },
            {
                "ts_name": "",
                "service_name": "ＢＳひかり",
                "service_type": 1,
                "tsid": 16592,
                "service_provider_name": "ＢＳひかり",
                "sid": 141,
                "remote_control_key_id": 4,
                "network_name": "BS Digital",
                "partialReceptionFlag": False,
                "onid": 4
            }
        ]
        self.reserves = [
            {
                "reserveID": 2927,
                "title": "アニメ 星屑カフェの日常 第3期 #7",
                "startTime": "2026-05-14T23:00:00",
                "startTimeEpg": "2026-05-14T23:00:00",
                "durationSecond": 1800,
                "stationName": "ＢＳひかり",
                "onid": 4,
                "tsid": 16592,
                "sid": 141,
                "eid": 1732,
                "comment": "EPG自動予約",
                "overlapMode": 0,
                "recSetting": {
                    "recMode": 1,
                    "priority": 2,
                    "tuijyuuFlag": True,
                    "suspendMode": 0,
                    "recFolderList": [{"recFolder": "!Default", "writePlugIn": "Write_Default.so", "recNamePlugIn": ""}]
                }
            }
        ]
        self.rec_infos = [
            {
                "id": 6762,
                "title": "架空戦記ミナト #06 [字]",
                "startTime": "2026-05-14T11:30:00",
                "durationSecond": 1800,
                "serviceName": "ＫＴ－Ｚ",
                "onid": 7,
                "tsid": 28928,
                "sid": 333,
                "eid": 51220,
                "recFilePath": "/mnt/disk1/raw/架空戦記ミナト #06 -202605141130.ts",
                "recStatus": 1,
                "drops": 0,
                "scrambles": 0,
                "protectFlag": False,
                "comment": "録画終了"
            }
        ]
        self.events = [
            {
                "eid": 951,
                "onid": 4,
                "tsid": 16400,
                "sid": 151,
                "startTime": "2026-05-14T12:00:00",
                "durationSecond": 6900,
                "shortInfo": {
                    "event_name": "[字]昼の特選ドラマ劇場 事件7",
                    "text_char": "「消えた手紙の女!」"
                },
                "extInfo": {
                    "text_char": "詳細な番組内容..."
                },
                "contentInfoList": [
                    {"nibble1": 3, "nibble2": 0, "component_type_name": {"nibble1": "ドラマ", "nibble2": "国内ドラマ"}}
                ]
            }
        ]
        self.auto_adds = []
        self.manu_adds = []
        self.next_reserve_id = 3000

    def handle(self, method: str, endpoint: str, params: dict, data: dict = None):
        params = params or {}
        data = data or {}

        if method == "GET":
            return self._handle_get(endpoint, params)
        elif method == "POST":
            return self._handle_post(endpoint, params, data)
        
        raise ValueError(f"EDCB demo mock unsupported method: {method}")

    def _handle_get(self, endpoint: str, params: dict):
        if endpoint == "EnumService":
            return {"items": self.services}
        elif endpoint == "EnumReserveInfo":
            return {"items": self.reserves}
        elif endpoint == "EnumRecInfo":
            return {"items": self.rec_infos}
        elif endpoint == "EnumEventInfo":
            return {"items": self.events}
        elif endpoint == "SearchEvent":
            return {"items": self.events}
        elif endpoint == "EnumAutoAdd":
            return {"items": self.auto_adds}
        elif endpoint == "EnumManuAdd":
            return {"items": self.manu_adds}
        elif endpoint == "EnumTunerReserveInfo":
            return {"items": []}
        elif endpoint == "EnumRecPreset":
            return {"items": [{"id": 0, "name": "デフォルト"}]}
        elif endpoint == "GetStorage":
            return {"items": [{"path": "/mnt/hdd1", "freeSpace": 1000000000000, "totalSpace": 2000000000000}]}
        elif endpoint == "GetTunerStatus":
            return {"items": []}
        
        # HTML系のモック（CSRFトークンなど）
        if "html" in endpoint:
            # dummy csrf token
            if "reserve" in endpoint:
                return "ctok='0123456789abcdef0123456789abcdef'"
            elif "autoadd" in endpoint:
                return 'name="ctok" value="0123456789abcdef0123456789abcdef"'
            return 'data-ctok="0123456789abcdef0123456789abcdef"'

        return {"demo_mock": True, "endpoint": endpoint}

    def _handle_post(self, endpoint: str, params: dict, data: dict):
        if endpoint == "SearchEvent":
            return {"items": self.events}
        elif endpoint == "SetReserve":
            if data.get("add"):
                self.reserves.append({
                    "reserveID": self.next_reserve_id,
                    "title": "手動追加予約(Demo)",
                    "startTime": "2026-05-14T23:00:00",
                    "durationSecond": 1800,
                    "stationName": "Demo",
                })
                self.next_reserve_id += 1
            elif data.get("del"):
                rid = int(params.get("id", 0))
                self.reserves = [r for r in self.reserves if r.get("reserveID") != rid]
            return {"success": True}
        elif endpoint == "DelRecInfo":
            rid = int(params.get("id", 0))
            self.rec_infos = [r for r in self.rec_infos if r.get("id") != rid]
            return {"success": True}
        
        return {"success": True, "demo_post_mock": True}
