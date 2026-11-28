"""プロファイルと自動選択"""

from typing import Any


class _ProfilesMixin:
    """AmatsukazeClient の一部（プロファイルと自動選択）。"""

    # =========================================================================
    # 5-4. プロファイル系
    # =========================================================================

    def get_profiles(self) -> list:
        """プロファイル一覧を取得。

        Returns:
            プロファイルオブジェクトのリスト
        """
        return self._get_json("/api/profiles")

    def get_profile_options(self) -> dict:
        """プロファイル設定で使用できる選択肢一覧を取得。

        Returns:
            ProfileOptions オブジェクト
        """
        return self._get_json("/api/profile-options")

    def add_profile(self, profile: dict) -> Any:
        """新規プロファイルを追加。

        Args:
            profile: プロファイルの JSON オブジェクト（{"name": "...", ...}）
        """
        return self._post_json("/api/profiles", profile)

    def update_profile(self, name: str, profile: dict) -> Any:
        """既存プロファイルを更新。

        Args:
            name:    URLエンコード前のプロファイル名
            profile: 更新後のプロファイルオブジェクト
        """
        import urllib.parse
        return self._put_json(f"/api/profiles/{urllib.parse.quote(name, safe='')}", profile)

    def remove_profile(self, name: str) -> bool:
        """プロファイルを削除。

        Args:
            name: 削除対象のプロファイル名
        """
        import urllib.parse
        return self._delete(f"/api/profiles/{urllib.parse.quote(name, safe='')}")

    # =========================================================================
    # 5-5. 自動選択系
    # =========================================================================

    def get_auto_selects(self) -> list:
        """自動選択設定一覧を取得。

        Returns:
            自動選択設定オブジェクトのリスト
        """
        return self._get_json("/api/autoselect")

    def get_auto_select_options(self) -> dict:
        """自動選択設定で使用できる選択肢を取得。

        Returns:
            AutoSelectOptionsView オブジェクト
        """
        return self._get_json("/api/autoselect/options")

    def add_auto_select(self, auto_select: dict) -> Any:
        """新規自動選択設定を追加。

        Args:
            auto_select: 自動選択設定オブジェクト（{"name": "...", ...}）
        """
        return self._post_json("/api/autoselect", auto_select)

    def update_auto_select(self, name: str, auto_select: dict) -> Any:
        """既存自動選択設定を更新。

        Args:
            name:        対象の自動選択設定名
            auto_select: 更新後のオブジェクト
        """
        import urllib.parse
        return self._put_json(f"/api/autoselect/{urllib.parse.quote(name, safe='')}", auto_select)

    def remove_auto_select(self, name: str) -> bool:
        """自動選択設定を削除。

        Args:
            name: 削除対象の自動選択設定名
        """
        import urllib.parse
        return self._delete(f"/api/autoselect/{urllib.parse.quote(name, safe='')}")
