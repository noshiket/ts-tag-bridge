"""AmatsukazeClient の一部（キューとメッセージの変わった分）"""

from typing import Any, Optional


class _ChangesMixin:
    """AmatsukazeClient の一部（キューとメッセージの変わった分）"""

    def get_queue_changes(self, since: int) -> dict:
        """差分キュー更新を取得（バージョン管理型ポーリング）。

        Args:
            since: 前回取得した version 番号

        Returns:
            QueueChangesView オブジェクト
        """
        return self._get_json("/api/queue/changes", {"since": since})

    def get_message_changes(
        self,
        since: int,
        *,
        page: Optional[str] = None,
        levels: Optional[str] = None,
        max: int = 50,
    ) -> dict:
        """メッセージログの差分を取得。

        Args:
            since:  この ID 以降のメッセージを取得
            page:   ページ名フィルタ
            levels: ログレベルフィルタ（カンマ区切り）
            max:    最大件数（デフォルト50）

        Returns:
            MessageChangesView オブジェクト
        """
        params: dict[str, Any] = {"since": since, "max": max}
        if page is not None:
            params["page"] = page
        if levels is not None:
            params["levels"] = levels
        return self._get_json("/api/messages/changes", params)
