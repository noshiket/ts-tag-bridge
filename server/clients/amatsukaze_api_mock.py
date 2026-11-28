import urllib.parse
from .amatsukaze_api_mock_get import _MockGetMixin
from .amatsukaze_api_mock_write import _MockWriteMixin

class AmatsukazeMockHandler(_MockGetMixin, _MockWriteMixin):
    """Amatsukaze API のモックハンドラー。
    base_url が 'demo' の場合に、実サーバーと同等のダミーレスポンスを返す。
    主要なデータ（キュー、プロファイル、設定など）はメモリ上で状態を持つ。
    """

    def __init__(self):
        # --- ステートフルな内部データ ---
        self.system_state = {
            "pause": False,
            "suspend": False,
            "encoderSuspended": [False, False],
            "running": False,
            "scheduledPause": False,
            "scheduledSuspend": False,
            "progress": 0
        }
        self.queue_items = [
            {
                "id": 1,
                "state": "complete",
                "srcPath": "/host-rootfs/home/user/video/sample1.ts",
                "priority": 3,
                "progress": 100,
                "profile": "QSVEnc-HEVC",
                "mode": "Batch",
                "consoleId": 1,
                "srcFileSize": 1024000,
                "duration": 1800,
                "tsTime": "2026-05-14T00:00:00",
                "inTime": "2026-05-14T01:00:00",
                "tags": ["Anime"],
                "genres": [{"level1": 7, "level2": 0}]
            }
        ]
        self.profiles = [
            {
                "name": "QSVEnc-HEVC",
                "description": "HEVC (H.265) QSV",
                "encoderType": "QSVEncC",
                "x264Option": "",
                "x265Option": "",
                "qsvEncOption": "--vpp-deinterlace bob --output-res 1280x720 --icq 23",
                "nvEncOption": "",
                "outputFormat": "MKV",
                "bitrate": {"a": 0.4, "b": 400, "h264": 1.6, "extensionData": {}},
                "filterSetting": {"enableResize": False, "enableTemporalNR": False},
                "numEncodeBufferFrames": 16,
                "encoderParallel": 1,
            }
        ]
        self.auto_selects = [
            {"name": "アニメ用自動選択", "profile": "QSVEnc-HEVC"}
        ]
        self.services = [
            {
                "serviceId": 211,
                "name": "ＢＳ９９ナイン",
                "logoList": [
                    {
                        "logoId": 0,
                        "fileName": "SID211-1.lgd",
                        "imageUrl": "/api/assets/logo/211/0",
                        "enabled": True,
                        "logoName": "ＢＳ９９ナイン(2025-06-23)",
                        "from": "2000-01-01T00:00:00",
                        "to": "2030-12-31T00:00:00",
                        "exists": True,
                        "imageWidth": 1920,
                        "imageHeight": 1080
                    }
                ]
            }
        ]
        self.settings = {
            "amatsukazePath": "/app/exe_files/AmatsukazeCLI",
            "x264Path": "/app/exe_files/x264",
            "x265Path": "/app/exe_files/x265",
            "qsvEncPath": "qsvencc",
            "nvEncPath": "nvencc",
            "workPath": "/tmp",
            "numParallel": 2,
            "numGPU": 1
        }
        self.makescript = {
            "profile": "QSVEnc-HEVC",
            "outDir": None,
            "nasDir": None,
            "isNasEnabled": False,
            "isWakeOnLan": False,
            "moveAfter": False,
            "clearEncoded": False,
            "withRelated": False,
            "isDirect": False,
            "priority": 3,
            "addQueueBat": None
        }
        self.next_queue_id = 2

    def handle(self, method: str, path: str, params: dict = None, payload=None, files=None):
        """メソッドとパスに基づいてモックレスポンスを返す"""
        params = params or {}
        
        # /api/profiles/URLエンコード文字列 などの展開
        path = urllib.parse.unquote(path)

        if method == "GET":
            return self._handle_get(path, params)
        elif method == "POST":
            return self._handle_post(path, payload, files)
        elif method == "PUT":
            return self._handle_put(path, payload)
        elif method == "DELETE":
            return self._handle_delete(path, payload)
        
        raise ValueError(f"Demo mock unsupported method: {method}")


