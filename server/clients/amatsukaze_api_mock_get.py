"""Amatsukaze の作り物: 読む（GET）"""

class _MockGetMixin:
    """Amatsukaze の作り物: 読む（GET）"""

    def _handle_get(self, path: str, params: dict):
        if path == "/api/snapshot":
            return {
                "system": self._handle_get("/api/system", {}),
                "queueView": self._handle_get("/api/queue", {}),
                "profiles": self.profiles
            }
        elif path == "/api/system":
            return {
                "serverInfo": {"logicalProcessorCount": 4, "restApiPort": 32769, "hostName": "demo-n100dcitx"},
                "state": self.system_state
            }
        elif path == "/api/server-env":
            return {"platform": "Linux", "isDocker": True}
        elif path == "/api/info/summary":
            return {"totalSpace": 1000000000000, "freeSpace": 500000000000}
        elif path == "/api/info/disks":
            return [{"path": "/mnt/hdd1", "totalSpace": 4000000000000, "freeSpace": 2000000000000}]
        elif path == "/api/info/latest-release":
            return {"tag": "v1.2.3", "url": "https://github.com/...", "publishedAt": "2026-05-10T00:00:00Z"}
        elif path == "/api/ui-state":
            return {"theme": "dark"}

        elif path == "/api/queue":
            return {"version": 10, "items": self.queue_items}
        elif path == "/api/queue/changes":
            return {"version": 11, "changes": []}
        elif path == "/api/messages/changes":
            return {"version": 5, "changes": []}

        elif path == "/api/logs/encode":
            return [{"encodeStart": "2026-05-14T10:00:00", "srcPath": "/video/test1.ts"}]
        elif path == "/api/logs/check":
            return []
        elif path == "/api/logs/encode/page":
            return {"total": 1, "items": [{"encodeStart": "2026-05-14T10:00:00", "srcPath": "/video/test1.ts"}]}
        elif path == "/api/logs/check/page":
            return {"total": 0, "items": []}
        elif path == "/api/logs/file":
            return {"content": "Demo encode log file content..."}
        elif path == "/api/logs/encode.csv" or path == "/api/logs/check.csv":
            return b"Date,SrcPath\n2026-05-14,test1.ts\n"

        elif path == "/api/profiles":
            return self.profiles
        elif path == "/api/profile-options":
            return {"encoders": ["x264", "x265", "QSVEncC", "NVEncC"]}

        elif path == "/api/autoselect":
            return self.auto_selects
        elif path == "/api/autoselect/options":
            return {"profiles": [p["name"] for p in self.profiles]}

        elif path == "/api/services":
            return self.services
        elif path == "/api/service-settings":
            return []
        elif path == "/api/service-options":
            return {"jlsCommands": ["logo_only", "full_scan"]}

        elif path == "/api/drcs":
            return [{"md5": "abcd1234abcd1234abcd1234abcd1234", "mapStr": "〠"}]
        elif path.startswith("/api/drcs/appearance/"):
            return {"md5": path.split("/")[-1], "items": []}

        elif path == "/api/settings":
            return self.settings
        elif path == "/api/settings/options":
            return {"logLevels": ["Debug", "Info", "Warn", "Error"]}

        elif path == "/api/makescript":
            return self.makescript
        elif path == "/api/batfiles/addqueue" or path == "/api/batfiles/queuefinish":
            return ["dummy_script.bat"]

        elif path == "/api/path/suggest":
            return {"dirs": [{"fullPath": "/mnt/hdd1"}, {"fullPath": "/home/user"}], "files": []}
            
        elif path.startswith("/api/trim/sessions/") and "/bundle/" in path:
            # 映像と波形のサイズ(4バイトずつ) + ダミーデータ
            return b"\x00\x00\x00\x00\x00\x00\x00\x00"

        # フォールバック
        return {"demo_mock": True, "path": path}
