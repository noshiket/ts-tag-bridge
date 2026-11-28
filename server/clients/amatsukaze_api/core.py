"""AmatsukazeClient の本体。メソッドは機能ごとに mixin へ分けてある。"""

from typing import Any, Optional
import requests
from .common import (  # noqa: F401
    BASE_URL,
)
from .queue import _QueueMixin
from .logs import _LogsMixin
from .profiles import _ProfilesMixin
from .services import _ServicesMixin
from .settings import _SettingsMixin
from .tools import _ToolsMixin


class AmatsukazeClient(_QueueMixin, _LogsMixin, _ProfilesMixin, _ServicesMixin, _SettingsMixin, _ToolsMixin):
    """Amatsukaze サーバー REST API クライアント

    すべてのメソッドが同期的に HTTP リクエストを行い、レスポンスの JSON を
    Python の dict / list / str / bytes として返す。
    エラー時は requests.HTTPError を raise する。

    Attributes:
        base_url: Amatsukaze サーバーのベース URL（末尾スラッシュなし）
        session:  接続再利用のための requests.Session
    """

    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.is_demo = (self.base_url == "demo")
        if self.is_demo:
            from clients.amatsukaze_api_mock import AmatsukazeMockHandler
            self.mock_handler = AmatsukazeMockHandler()
        else:
            self.session = requests.Session()

    # =========================================================================
    # 内部ユーティリティ
    # =========================================================================

    def _get_json(self, path: str, params: Optional[dict] = None) -> Any:
        """GET → JSON デシリアライズ"""
        p = {k: v for k, v in (params or {}).items() if v is not None}
        if self.is_demo:
            return self.mock_handler.handle("GET", path, params=p)
        resp = self.session.get(f"{self.base_url}{path}", params=p)
        resp.raise_for_status()
        return resp.json()

    def _get_text(self, path: str, params: Optional[dict] = None) -> str:
        """GET → テキスト"""
        p = {k: v for k, v in (params or {}).items() if v is not None}
        if self.is_demo:
            return str(self.mock_handler.handle("GET", path, params=p))
        resp = self.session.get(f"{self.base_url}{path}", params=p)
        resp.raise_for_status()
        return resp.text

    def _get_bytes(self, path: str, params: Optional[dict] = None) -> bytes:
        """GET → バイト列"""
        p = {k: v for k, v in (params or {}).items() if v is not None}
        if self.is_demo:
            res = self.mock_handler.handle("GET", path, params=p)
            return res if isinstance(res, bytes) else b""
        resp = self.session.get(f"{self.base_url}{path}", params=p)
        resp.raise_for_status()
        return resp.content

    def _post_json(self, path: str, payload: Any = None) -> Any:
        """POST JSON ボディ → JSON レスポンス"""
        if self.is_demo:
            return self.mock_handler.handle("POST", path, payload=payload)
        resp = self.session.post(
            f"{self.base_url}{path}",
            json=payload if payload is not None else {},
        )
        resp.raise_for_status()
        # 204 No Content の場合は None を返す
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    def _put_json(self, path: str, payload: Any = None) -> Any:
        """PUT JSON ボディ → JSON レスポンス"""
        if self.is_demo:
            return self.mock_handler.handle("PUT", path, payload=payload)
        resp = self.session.put(
            f"{self.base_url}{path}",
            json=payload if payload is not None else {},
        )
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    def _delete(self, path: str) -> bool:
        """DELETE → 成功 True"""
        if self.is_demo:
            return self.mock_handler.handle("DELETE", path)
        resp = self.session.delete(f"{self.base_url}{path}")
        resp.raise_for_status()
        return True

    def _delete_json(self, path: str, payload: Any = None) -> bool:
        """DELETE + JSON ボディ → 成功 True"""
        if self.is_demo:
            return self.mock_handler.handle("DELETE", path, payload=payload)
        resp = self.session.delete(
            f"{self.base_url}{path}",
            json=payload if payload is not None else {},
        )
        resp.raise_for_status()
        return True

    def _post_multipart(self, path: str, files: dict, data: Optional[dict] = None) -> Any:
        """POST multipart/form-data → JSON レスポンス"""
        p = {k: v for k, v in (data or {}).items() if v is not None}
        if self.is_demo:
            return self.mock_handler.handle("POST", path, payload=p, files=files)
        resp = self.session.post(
            f"{self.base_url}{path}",
            files=files,
            data=p,
        )
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()
