"""ログ"""

from typing import Any, Optional


class _LogsMixin:
    """AmatsukazeClient の一部（ログ）。"""

    # =========================================================================
    # 5-3. ログ系
    # =========================================================================

    def get_encode_logs(self) -> list:
        """エンコードログ全件取得。

        Returns:
            LogItemView のリスト
        """
        return self._get_json("/api/logs/encode")

    def get_check_logs(self) -> list:
        """チェックログ全件取得。

        Returns:
            CheckLogItemView のリスト
        """
        return self._get_json("/api/logs/check")

    def get_encode_logs_page(self, offset: int = 0, limit: int = 20) -> dict:
        """エンコードログをページング取得。

        Args:
            offset: 開始位置
            limit:  取得件数

        Returns:
            { "total": N, "items": [...] }
        """
        return self._get_json("/api/logs/encode/page", {"offset": offset, "limit": limit})

    def get_check_logs_page(self, offset: int = 0, limit: int = 20) -> dict:
        """チェックログをページング取得。

        Args:
            offset: 開始位置
            limit:  取得件数

        Returns:
            { "total": N, "items": [...] }
        """
        return self._get_json("/api/logs/check/page", {"offset": offset, "limit": limit})

    def get_log_file(
        self,
        encode_start: Optional[str] = None,
        check_start: Optional[str] = None,
    ) -> dict:
        """特定エンコード/チェック結果のログファイル内容を取得。

        Args:
            encode_start: エンコード開始時刻 (yyyy-MM-ddTHH:mm:ss.fff)
            check_start:  チェック開始時刻 (yyyy-MM-ddTHH:mm:ss.fff)

        Returns:
            LogFileContent オブジェクト
        """
        params: dict[str, Any] = {}
        if encode_start is not None:
            params["encodeStart"] = encode_start
        if check_start is not None:
            params["checkStart"] = check_start
        return self._get_json("/api/logs/file", params)

    def get_encode_csv(self) -> bytes:
        """エンコードログをCSV形式でダウンロード。

        Returns:
            CSV バイト列
        """
        return self._get_bytes("/api/logs/encode.csv")

    def get_check_csv(self) -> bytes:
        """チェックログをCSV形式でダウンロード。

        Returns:
            CSV バイト列
        """
        return self._get_bytes("/api/logs/check.csv")
