"""AmatsukazeClient の一部（サーバーの状態・情報・終了と眠りの取り消し）"""

from typing import Any


class _SystemMixin:
    """AmatsukazeClient の一部（サーバーの状態・情報・終了と眠りの取り消し）"""

    def get_snapshot(self) -> dict:
        """全体スナップショット（キュー・ログ・コンソール・プロファイル・設定）を一括取得。

        Returns:
            Snapshot オブジェクト
        """
        return self._get_json("/api/snapshot")

    def get_system(self) -> dict:
        """システム状態（エンコード中タスク・ワーカー状態など）を取得。

        Returns:
            SystemSnapshot オブジェクト
        """
        return self._get_json("/api/system")

    def get_server_env(self) -> dict:
        """サーバー環境情報（OSプラットフォーム等）を取得。

        Returns:
            ServerEnvironmentView オブジェクト
        """
        return self._get_json("/api/server-env")

    def get_info_summary(self) -> dict:
        """情報サマリーを取得。

        Returns:
            InfoSummaryView オブジェクト
        """
        return self._get_json("/api/info/summary")

    def get_info_disks(self) -> list:
        """ディスク使用量一覧を取得。

        Returns:
            DiskUsageView のリスト
        """
        return self._get_json("/api/info/disks")

    def get_latest_release(self) -> dict:
        """最新リリース情報を取得。

        Returns:
            { "tag": "v1.2.3", "url": "...", "publishedAt": "..." }
        """
        return self._get_json("/api/info/latest-release")

    def get_ui_state(self) -> dict:
        """UI状態を取得。

        Returns:
            UiStateView オブジェクト
        """
        return self._get_json("/api/ui-state")

    def end_server(self) -> Any:
        """サーバーを終了する。"""
        return self._post_json("/api/system/end")

    def cancel_sleep(self) -> Any:
        """スリープ予約をキャンセルする。"""
        return self._post_json("/api/system/cancel-sleep")
