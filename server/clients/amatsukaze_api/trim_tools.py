"""AmatsukazeClient の一部（トリムの画面・パスの候補）"""

import struct
from typing import Any, Optional


class _TrimToolsMixin:
    """AmatsukazeClient の一部（トリムの画面・パスの候補）"""

    def create_trim_session(
        self,
        queue_item_id: int,
        scale_mode: int = 0,
    ) -> dict:
        """Trim調整セッションを作成。

        Args:
            queue_item_id: 対象キューアイテムID
            scale_mode:    スケールモード（デフォルト 0）

        Returns:
            TrimAdjustSessionResponse
            { "sessionId": "...", "numFrames": N, "frameWidth": W,
              "frameHeight": H, "trims": [...], "framePts": [...] }
        """
        payload = {"queueItemId": queue_item_id, "scaleMode": scale_mode}
        return self._post_json("/api/trim/sessions", payload)

    def get_trim_bundle(self, session_id: str, frame: int) -> tuple[bytes, bytes]:
        """指定フレームの映像プレビューJPEG＋波形JPEGをバイナリバンドルで取得。

        レスポンスのバイナリ形式:
            先頭 4 バイト = 映像 JPEG サイズ (int32 LE)
            次の 4 バイト = 波形 JPEG サイズ (int32 LE)
            以降 = 映像 JPEG データ + 波形 JPEG データ

        Note:
            エンドポイントは /api/trim/sessions/{id}/bundle/{frame}（パスパラメータ）。
            C# AmatsukazeApi.cs の GetTrimBundleAsync に対応。

        Args:
            session_id: create_trim_session() が返した sessionId
            frame:      取得するフレーム番号

        Returns:
            (video_jpeg: bytes, waveform_jpeg: bytes)
        """
        raw = self._get_bytes(
            f"/api/trim/sessions/{session_id}/bundle/{frame}",
        )
        video_size, waveform_size = struct.unpack_from("<II", raw, 0)
        video_jpeg = raw[8: 8 + video_size]
        waveform_jpeg = raw[8 + video_size: 8 + video_size + waveform_size]
        return video_jpeg, waveform_jpeg

    def save_trims(self, session_id: str, trims: list[dict]) -> Any:
        """Trim の範囲を保存。

        Args:
            session_id: create_trim_session() が返した sessionId
            trims:      トリム範囲のリスト。例: [{"start": 0, "end": 999}, ...]

        Returns:
            サーバーレスポンス
        """
        payload = {"trims": trims}
        return self._post_json(f"/api/trim/sessions/{session_id}/save", payload)

    def delete_trim_session(self, session_id: str) -> bool:
        """Trim調整セッションを削除。

        Args:
            session_id: 削除対象のセッションID
        """
        return self._delete(f"/api/trim/sessions/{session_id}")

    def delete_trim_tempdir(self, queue_item_id: int) -> bool:
        """指定キューアイテムのTrim一時フォルダを削除（カット編集後のクリーンアップ用）。

        Args:
            queue_item_id: 対象キューアイテムID
        """
        return self._delete(f"/api/trim/tempdir/{queue_item_id}")

    def get_path_suggest(
        self,
        input: str,
        *,
        ext: Optional[str] = None,
        max_dirs: int = 10,
        max_files: int = 20,
        allow_files: bool = True,
        allow_dirs: bool = True,
        check_access: bool = False,
        dir_offset: int = 0,
        file_offset: int = 0,
    ) -> dict:
        """パス入力補完候補を取得。

        Args:
            input:        入力文字列
            ext:          拡張子フィルタ（例: ".ts"）
            max_dirs:     ディレクトリ最大候補数
            max_files:    ファイル最大候補数
            allow_files:  ファイル候補を含めるか
            allow_dirs:   ディレクトリ候補を含めるか
            check_access: アクセス可能かチェックするか
            dir_offset:   ディレクトリのページングオフセット
            file_offset:  ファイルのページングオフセット

        Returns:
            PathSuggestResponse
            { "input": "...", "baseDir": "...",
              "dirs": [{"name": "...", "fullPath": "...", "startsWith": bool, "matchIndex": int}, ...],
              "files": [...], "hasMoreDirs": bool, "hasMoreFiles": bool,
              "nextDirOffset": int, "nextFileOffset": int }
        """
        params: dict[str, Any] = {
            "input": input,
            "maxDirs": max_dirs,
            "maxFiles": max_files,
            "allowFiles": str(allow_files).lower(),
            "allowDirs": str(allow_dirs).lower(),
            "checkAccess": str(check_access).lower(),
            "dirOffset": dir_offset,
            "fileOffset": file_offset,
        }
        if ext is not None:
            params["ext"] = ext
        return self._get_json("/api/path/suggest", params)
