"""設定・スクリプト・コンソール"""

from typing import Any, Optional


class _SettingsMixin:
    """AmatsukazeClient の一部（設定・スクリプト・コンソール）。"""

    # =========================================================================
    # 5-8. 設定・スクリプト系
    # =========================================================================

    def get_settings(self) -> dict:
        """サーバー設定を取得（JsonElement 形式）。

        Note:
            エンドポイントは /api/settings（複数）。
            調査ドキュメントの C# マッピング表は単数形と記載されていたが、
            実サーバー検証で複数形が正しいことを確認済み。

        Returns:
            設定オブジェクト
        """
        return self._get_json("/api/settings")

    def get_settings_options(self) -> dict:
        """設定画面で使用できる選択肢を取得。"""
        return self._get_json("/api/settings/options")

    def update_settings(self, settings: dict) -> Any:
        """サーバー設定を更新（get_settings() の戻り値をそのまま PUT）。

        Args:
            settings: 更新後の設定オブジェクト
        """
        return self._put_json("/api/settings", settings)

    def get_makescript(self) -> dict:
        """スクリプト生成設定を取得。

        Returns:
            MakeScriptData オブジェクト
            例: { "profile": "デフォルト", "outDir": "/encoded/", ... }
        """
        return self._get_json("/api/makescript")

    def update_makescript(self, make_script_data: dict) -> Any:
        """スクリプト生成設定を保存。

        Args:
            make_script_data: get_makescript() の戻り値と同形式
        """
        return self._put_json("/api/makescript", make_script_data)

    def get_batfiles_addqueue(self) -> list:
        """キュー追加バットファイル一覧を取得。"""
        return self._get_json("/api/batfiles/addqueue")

    def get_batfiles_queuefinish(self) -> list:
        """キュー完了バットファイル一覧を取得。"""
        return self._get_json("/api/batfiles/queuefinish")

    def get_makescript_preview(self) -> dict:
        """現在のスクリプト生成設定でプレビューを取得。

        Returns:
            MakeScriptPreview オブジェクト（コマンドライン文字列）
        """
        return self._get_json("/api/makescript/preview")

    def post_makescript_preview(
        self,
        make_script_data: dict,
        *,
        target_host: str = "local",
        script_type: str = "sh",
        remote_host: Optional[str] = None,
        subnet: Optional[str] = None,
        mac: Optional[str] = None,
    ) -> dict:
        """指定設定でスクリプトプレビューを生成。

        Args:
            make_script_data: MakeScriptData オブジェクト
            target_host:      実行ホスト ("local" 等)
            script_type:      スクリプト種別 ("sh" / "ps1" 等)
            remote_host:      リモートホスト名（省略可）
            subnet:           サブネット（省略可）
            mac:              MACアドレス（省略可）

        Returns:
            MakeScriptPreview オブジェクト
        """
        payload = {
            "makeScriptData": make_script_data,
            "targetHost": target_host,
            "scriptType": script_type,
            "remoteHost": remote_host,
            "subnet": subnet,
            "mac": mac,
        }
        return self._post_json("/api/makescript/preview", payload)

    def post_makescript_file(
        self,
        make_script_data: dict,
        *,
        target_host: str = "local",
        script_type: str = "sh",
        remote_host: Optional[str] = None,
        subnet: Optional[str] = None,
        mac: Optional[str] = None,
    ) -> str:
        """指定設定でスクリプトファイルの内容（文字列）を生成して返す。

        Args:
            make_script_data: MakeScriptData オブジェクト
            target_host:      実行ホスト
            script_type:      スクリプト種別
            remote_host:      リモートホスト名（省略可）
            subnet:           サブネット（省略可）
            mac:              MACアドレス（省略可）

        Returns:
            生成されたスクリプト文字列
        """
        payload = {
            "makeScriptData": make_script_data,
            "targetHost": target_host,
            "scriptType": script_type,
            "remoteHost": remote_host,
            "subnet": subnet,
            "mac": mac,
        }
        resp = self.session.post(f"{self.base_url}/api/makescript/file", json=payload)
        resp.raise_for_status()
        return resp.text

    def update_finish_setting(self, finish_setting: dict) -> Any:
        """終了設定（スリープ・シャットダウン等）を更新。

        Args:
            finish_setting: FinishSetting オブジェクト
        """
        return self._put_json("/api/finish-setting", finish_setting)

    # =========================================================================
    # 5-9. コンソール・タスク系
    # =========================================================================

    def get_console(self, task_id: int) -> dict:
        """指定タスクのコンソール出力を取得。

        Args:
            task_id: タスクID

        Returns:
            { "task": {...}, "lines": [...], "version": N }
        """
        return self._get_json(f"/api/console/{task_id}")

    def get_console_changes(self, task_id: int, since: int) -> dict:
        """指定タスクのコンソール出力差分を取得（バージョン管理型ポーリング）。

        Args:
            task_id: タスクID
            since:   前回取得した version 番号

        Returns:
            { "fromVersion": N, "toVersion": M, "fullSyncRequired": bool,
              "changes": [{"type": "Add"/"Replace"/"Clear", "line": "..."}, ...] }
        """
        return self._get_json(f"/api/console/{task_id}/changes", {"since": since})
