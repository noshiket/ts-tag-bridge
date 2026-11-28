"""システムの状態とキュー"""

from typing import Any, Optional
from .system import _SystemMixin
from .changes import _ChangesMixin


class _QueueMixin(_ChangesMixin, _SystemMixin):
    """AmatsukazeClient の一部（システムの状態とキュー）。"""

    # =========================================================================
    # 5-1. スナップショット・システム系
    # =========================================================================


    # =========================================================================
    # 5-2. キュー管理系
    # =========================================================================

    def get_queue(
        self,
        *,
        state: Optional[list[str]] = None,
        search: Optional[str] = None,
        search_targets: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        hide_one_seg: Optional[bool] = None,
    ) -> dict:
        """キュー一覧を取得。

        Args:
            state:          状態フィルタ（例: ["active", "complete"]）
            search:         キーワード検索
            search_targets: 検索対象列をカンマ区切りで指定
            date_from:      日付範囲開始 (yyyy-MM-dd)
            date_to:        日付範囲終了 (yyyy-MM-dd)
            hide_one_seg:   ワンセグアイテムを非表示

        Returns:
            QueueView オブジェクト
        """
        params: dict[str, Any] = {}
        if state:
            # requests は同名パラメータを複数送信できる
            params["state"] = state
        if search is not None:
            params["search"] = search
        if search_targets is not None:
            params["searchTargets"] = search_targets
        if date_from is not None:
            params["dateFrom"] = date_from
        if date_to is not None:
            params["dateTo"] = date_to
        if hide_one_seg is not None:
            params["hideOneSeg"] = str(hide_one_seg).lower()
        return self._get_json("/api/queue", params)


    def add_queue(
        self,
        *,
        dir_path: Optional[str] = None,
        targets: Optional[list[dict]] = None,
        mode: str = "Batch",
        outputs: Optional[list[dict]] = None,
        request_id: Optional[str] = None,
        add_queue_bat: Optional[str] = None,
    ) -> dict:
        """エンコードキューにアイテムを追加する。

        Args:
            dir_path:      ディレクトリ一括追加（targets と排他）
            targets:       追加対象ファイルのリスト。各要素は {"path": "...", "hash": null}
            mode:          "Batch" / "Test" / "DrcsCheck" / "CMCheck"
            outputs:       出力先リスト。各要素は {"dstPath": "...", "profile": "...", "priority": 3}
            request_id:    追跡用ID（省略可）
            add_queue_bat: 追加時実行BATファイル名

        Returns:
            { "requestId": "..." }
        """
        payload = {
            "dirPath": dir_path,
            "targets": targets,
            "mode": mode,
            "outputs": outputs,
            "requestId": request_id,
            "addQueueBat": add_queue_bat,
        }
        return self._post_json("/api/queue/add", payload)

    def change_queue(
        self,
        item_id: int,
        change_type: str,
        *,
        worker_id: int = 0,
        priority: int = 0,
        profile: Optional[str] = None,
        mode: Optional[str] = None,
        position: int = 0,
        request_id: Optional[str] = None,
    ) -> Any:
        """キューアイテムを操作（キャンセル・優先度変更・プロファイル変更など）。

        Args:
            item_id:     対象キューアイテムID
            change_type: "ResetState" / "UpdateProfile" / "Duplicate" / "Cancel" /
                         "Priority" / "Profile" / "RemoveItem" / "RemoveCompleted" /
                         "ForceStart" / "RemoveSourceFile" / "Move"
            worker_id:   ワーカーID（通常0）
            priority:    優先度 1〜5（change_type="Priority" 時に使用）
            profile:     プロファイル名（change_type="Profile" / "UpdateProfile" 時に使用）
            mode:        処理モード（オプション）
            position:    移動先インデックス（change_type="Move" 時に使用）
            request_id:  追跡用ID
        """
        payload = {
            "itemId": item_id,
            "workerId": worker_id,
            "changeType": change_type,
            "priority": priority,
            "profile": profile,
            "mode": mode,
            "position": position,
            "requestId": request_id,
        }
        return self._post_json("/api/queue/change", payload)

    def move_queue_many(
        self,
        item_ids: list[int],
        drop_index: int,
        *,
        request_id: Optional[str] = None,
    ) -> Any:
        """複数アイテムを一括で指定位置へ移動。

        Args:
            item_ids:   移動対象アイテムIDのリスト
            drop_index: ドロップ先インデックス
            request_id: 追跡用ID
        """
        payload = {
            "itemIds": item_ids,
            "dropIndex": drop_index,
            "requestId": request_id,
        }
        return self._post_json("/api/queue/move-many", payload)

    def pause_queue(
        self,
        pause: bool,
        *,
        is_queue: bool = True,
        index: int = 0,
    ) -> Any:
        """キューまたは特定ワーカーを一時停止/再開。

        Args:
            pause:    True=停止、False=再開
            is_queue: True=キュー全体、False=特定ワーカー
            index:    ワーカーインデックス（is_queue=False 時に使用）
        """
        payload = {
            "isQueue": is_queue,
            "index": index,
            "pause": pause,
        }
        return self._post_json("/api/queue/pause", payload)

    def cancel_add_queue(self) -> Any:
        """追加中のキュー追加処理をキャンセル。"""
        return self._post_json("/api/queue/cancel-add")
