"""AmatsukazeClient の一部（DRCS 外字の対応表）"""

from typing import Any


class _DrcsMixin:
    """AmatsukazeClient の一部（DRCS 外字の対応表）"""

    def get_drcs(self) -> list:
        """DRCS外字マッピング一覧を取得。

        Returns:
            DrcsView のリスト
        """
        return self._get_json("/api/drcs")

    def add_drcs(self, payload: dict) -> Any:
        """DRCS外字画像を追加。

        Args:
            payload: DRCS 画像データ（{"image": "base64..."} 等）
        """
        return self._post_json("/api/drcs", payload)

    def update_drcs_map(self, md5: str, map_str: str) -> Any:
        """DRCS外字のマッピング文字列を更新。

        Args:
            md5:     DRCS 外字の MD5 ハッシュ
            map_str: マッピングする文字列（例: "〠"）
        """
        payload = {"md5": md5, "mapStr": map_str}
        return self._put_json("/api/drcs/map", payload)

    def delete_drcs_map(self, md5: str) -> bool:
        """DRCS外字マッピングを削除。

        Args:
            md5: 削除対象の DRCS 外字 MD5 ハッシュ
        """
        import urllib.parse
        return self._delete(f"/api/drcs/map/{urllib.parse.quote(md5, safe='')}")

    def get_drcs_appearance(self, md5: str) -> dict:
        """指定 MD5 の DRCS 外字が出現するキューアイテム一覧を取得。

        Args:
            md5: DRCS 外字の MD5 ハッシュ

        Returns:
            { "md5": "...", "items": ["/path/to/file.ts", ...] }
        """
        import urllib.parse
        return self._get_json(f"/api/drcs/appearance/{urllib.parse.quote(md5, safe='')}")
