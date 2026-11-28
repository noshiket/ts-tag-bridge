"""EDCBClient の本体。メソッドは機能ごとに mixin へ分けてある。"""

import re
import time
import requests
from read_tsprogram.program_info import BaseProgramReader
from .common import (  # noqa: F401
    BASE_URL,
    _CSRF_PAGES,
)
from .epg import _EpgMixin
from .reserves import _ReservesMixin
from .recinfo import _RecInfoMixin
from .programs import _ProgramsMixin


class EDCBClient(_EpgMixin, _ReservesMixin, _RecInfoMixin, _ProgramsMixin, BaseProgramReader):
    def __init__(self, base_url: str = BASE_URL):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.is_demo = (self.base_url == "demo")
        if self.is_demo:
            from clients.edcb_api_mock import EDCBMockHandler
            self.mock_handler = EDCBMockHandler()
        else:
            self.session = requests.Session()
        self._service_map: dict[tuple[int, int, int], str] = {}  # (onid,tsid,sid) -> service_name
        self._csrf_cache: dict[str, tuple[str, int]] = {}        # name -> (token, epoch_12h)

    def _get(self, endpoint: str, params: dict = None) -> dict | list:
        p = {k: v for k, v in (params or {}).items() if v is not None}
        p["json"] = 1
        if self.is_demo:
            data = self.mock_handler.handle("GET", endpoint, params=p)
        else:
            resp = self.session.get(f"{self.base_url}/api/{endpoint}", params=p)
            resp.raise_for_status()
            data = resp.json()
        # リスト系レスポンスは {"total":N, "items":[...]} 形式なので items を展開する
        if isinstance(data, dict) and "items" in data:
            return data["items"]
        # EDCB エラーレスポンス {"err": "..."} を例外に変換
        if isinstance(data, dict) and "err" in data and "items" not in data:
            raise RuntimeError(data["err"])
        return data

    def _post(self, endpoint: str, params: dict = None, data: dict = None) -> dict:
        p = {k: v for k, v in (params or {}).items() if v is not None}
        p["json"] = 1
        d = {k: v for k, v in (data or {}).items() if v is not None}
        if self.is_demo:
            result = self.mock_handler.handle("POST", endpoint, params=p, data=d)
        else:
            resp = self.session.post(f"{self.base_url}/api/{endpoint}", params=p, data=d)
            resp.raise_for_status()
            result = resp.json()
        if isinstance(result, dict) and "err" in result and "success" not in result:
            raise RuntimeError(result["err"])
        return result

    # -------------------------------------------------------------------------
    # CSRF トークン
    # -------------------------------------------------------------------------

    def _get_csrf_token(self, name: str) -> str:
        """CSRF トークンを取得してキャッシュする（12時間ごとに更新）"""
        if self.is_demo:
            return "0123456789abcdef0123456789abcdef"
        epoch = int(time.time()) // (3600 * 12)
        cached = self._csrf_cache.get(name)
        if cached and cached[1] == epoch:
            return cached[0]

        entry = _CSRF_PAGES.get(name)
        if entry is None:
            raise ValueError(f"Unknown CSRF token name: {name}")
        path, pattern = entry

        resp = self.session.get(f"{self.base_url}{path}")
        resp.raise_for_status()
        m = re.search(pattern, resp.text)
        if not m:
            raise ValueError(f"CSRF token '{name}' not found in {path}")
        token = m.group(1)
        self._csrf_cache[name] = (token, epoch)
        return token

    # -------------------------------------------------------------------------
    # ProgramInfo 変換
    # -------------------------------------------------------------------------

    def _load_service_map(self) -> None:
        """サービス名キャッシュを構築する（未構築時のみ実行）"""
        if self._service_map:
            return
        for s in self.enum_service():
            self._service_map[(s["onid"], s["tsid"], s["sid"])] = s["service_name"]
