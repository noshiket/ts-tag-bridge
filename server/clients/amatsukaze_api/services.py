"""サービス・ロゴ・DRCS"""

from typing import Any, Optional
from .drcs import _DrcsMixin


class _ServicesMixin(_DrcsMixin):
    """AmatsukazeClient の一部（サービス・ロゴ・DRCS）。"""

    # =========================================================================
    # 5-6. サービス・ロゴ系
    # =========================================================================

    def get_services(self) -> list:
        """サービス（放送局）一覧をロゴ情報付きで取得。

        Returns:
            ServiceView のリスト
        """
        return self._get_json("/api/services")

    def update_service(self, service: dict) -> Any:
        """サービス情報を更新（JsonElement を直接 POST）。

        Args:
            service: サービスオブジェクト（{"serviceId": 1024, ...}）
        """
        return self._post_json("/api/services/update", service)

    def upload_logo(
        self,
        lgd_bytes: bytes,
        *,
        filename: str = "logo.lgd",
        service_id: Optional[int] = None,
        imgw: Optional[int] = None,
        imgh: Optional[int] = None,
    ) -> Any:
        """ロゴファイル（.lgd）をアップロード。

        Args:
            lgd_bytes:  lgd ファイルのバイト列
            filename:   multipart ファイル名（任意）
            service_id: サービスID（省略可）
            imgw:       画像幅（省略可）
            imgh:       画像高さ（省略可）

        Returns:
            サーバーレスポンス
        """
        files = {"image": (filename, lgd_bytes, "application/octet-stream")}
        data: dict[str, Any] = {}
        if service_id is not None:
            data["serviceId"] = service_id
        if imgw is not None:
            data["imgw"] = imgw
        if imgh is not None:
            data["imgh"] = imgh
        return self._post_multipart("/api/services/logo", files, data)

    def probe_logo(self, lgd_bytes: bytes, filename: str = "logo.lgd") -> dict:
        """lgd ファイルの内容を解析してサービス情報を返す。

        Args:
            lgd_bytes: lgd ファイルのバイト列
            filename:  multipart ファイル名（任意）

        Returns:
            { "isExtended": bool, "serviceId": int, "serviceName": str,
              "imageWidth": int, "imageHeight": int }
        """
        files = {"image": (filename, lgd_bytes, "application/octet-stream")}
        return self._post_multipart("/api/services/logo/probe", files)

    def rescan_logo(self) -> Any:
        """ロゴファイルを再スキャン。"""
        return self._post_json("/api/services/logo/rescan")

    def get_service_settings(self) -> list:
        """サービス設定一覧（ロゴ・JLS設定等）を取得。

        Returns:
            ServiceSettingView のリスト
        """
        return self._get_json("/api/service-settings")

    def get_service_options(self) -> dict:
        """サービス設定オプション（JLSコマンドファイル一覧等）を取得。"""
        return self._get_json("/api/service-options")

    def update_logo_period(
        self,
        service_id: int,
        file_name: str,
        from_: str,
        to: str,
    ) -> Any:
        """ロゴの有効期間を更新。

        Args:
            service_id: サービスID
            file_name:  ロゴファイル名（例: "logo_1024.lgd"）
            from_:      有効開始日時 ISO 8601 文字列
            to:         有効終了日時 ISO 8601 文字列
        """
        payload = {"fileName": file_name, "from": from_, "to": to}
        return self._put_json(f"/api/service-settings/{service_id}/logos/period", payload)

    def update_logo_enabled(
        self,
        service_id: int,
        file_name: str,
        enabled: bool,
    ) -> Any:
        """ロゴの有効/無効を切り替え。

        Args:
            service_id: サービスID
            file_name:  ロゴファイル名
            enabled:    True=有効、False=無効
        """
        payload = {"fileName": file_name, "enabled": enabled}
        return self._put_json(f"/api/service-settings/{service_id}/logos/enabled", payload)

    def delete_logo(self, service_id: int, file_name: str) -> bool:
        """ロゴファイルを削除。

        Args:
            service_id: サービスID
            file_name:  削除対象ロゴファイル名
        """
        return self._delete_json(
            f"/api/service-settings/{service_id}/logos",
            {"fileName": file_name},
        )

    def add_no_logo(self, service_id: int) -> Any:
        """「ロゴなし」設定を追加。

        Args:
            service_id: サービスID
        """
        return self._post_json(f"/api/service-settings/{service_id}/logos/no-logo")

    def remove_no_logo(self, service_id: int) -> bool:
        """「ロゴなし」設定を解除。

        Args:
            service_id: サービスID
        """
        return self._delete(f"/api/service-settings/{service_id}/logos/no-logo")

    # =========================================================================
    # 5-7. DRCS系
    # =========================================================================


