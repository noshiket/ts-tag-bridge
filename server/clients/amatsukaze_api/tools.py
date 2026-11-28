"""ロゴ解析・トリム・パスの候補"""

from typing import Any
from .trim_tools import _TrimToolsMixin


class _ToolsMixin(_TrimToolsMixin):
    """AmatsukazeClient の一部（ロゴ解析・トリム・パスの候補）。"""

    # =========================================================================
    # 5-10. ロゴ解析系
    # =========================================================================

    def start_logo_analyze(
        self,
        queue_item_id: int,
        *,
        x: int = 10,
        y: int = 10,
        width: int = 72,
        height: int = 36,
        threshold: int = 12,      # Amatsukaze 本体のロゴ解析と同じ既定値
        max_frames: int = 20000,  # 同上（少ないとファイル冒頭しか走査されない）
    ) -> dict:
        """ロゴ解析ジョブを開始。

        Args:
            queue_item_id: 解析対象のキューアイテムID
            x:             解析領域の X 座標
            y:             解析領域の Y 座標
            width:         解析領域の幅
            height:        解析領域の高さ
            threshold:     検出閾値
            max_frames:    最大フレーム数

        Returns:
            初回 LogoAnalyzeStatus オブジェクト（jobId を含む）
        """
        payload = {
            "queueItemId": queue_item_id,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "threshold": threshold,
            "maxFrames": max_frames,
        }
        return self._post_json("/api/logo/analyze", payload)

    def get_logo_analyze_status(self, job_id: str) -> dict:
        """ロゴ解析の進捗を取得。

        Args:
            job_id: start_logo_analyze() が返した jobId

        Returns:
            LogoAnalyzeStatus オブジェクト
            { "jobId": "...", "completed": bool, "error": str|null,
              "progress": float, "numRead": int, "numTotal": int,
              "numValid": int, "pass": int, "logoFileName": str|null,
              "imageUrl": str|null }
        """
        return self._get_json(f"/api/logo/analyze/{job_id}")

    def get_logo_analyze_image(self, job_id: str) -> bytes:
        """解析中ロゴプレビュー画像（JPEG バイナリ）を取得。

        Args:
            job_id: 解析ジョブID

        Returns:
            JPEG バイト列
        """
        return self._get_bytes(f"/api/logo/analyze/{job_id}/image")

    def get_logo_analyze_file(self, job_id: str) -> bytes:
        """解析完了後のロゴファイル（lgd バイナリ）をダウンロード。

        Args:
            job_id: 解析ジョブID

        Returns:
            lgd バイト列
        """
        return self._get_bytes(f"/api/logo/analyze/{job_id}/file")

    def apply_logo_analyze(self, job_id: str) -> Any:
        """解析結果のロゴをサーバーに適用。

        Args:
            job_id: 解析ジョブID
        """
        return self._post_json(f"/api/logo/analyze/{job_id}/apply")

    def discard_logo_analyze(self, job_id: str) -> Any:
        """解析結果を破棄。

        Args:
            job_id: 解析ジョブID
        """
        return self._post_json(f"/api/logo/analyze/{job_id}/discard")

    def create_logo_preview_session(
        self,
        queue_item_id: int,
        service_id: int,
    ) -> dict:
        """ロゴプレビューセッションを作成。

        Args:
            queue_item_id: キューアイテムID
            service_id:    サービスID

        Returns:
            { "sessionId": "..." }
        """
        payload = {"queueItemId": queue_item_id, "serviceId": service_id}
        return self._post_json("/api/logo/preview/sessions", payload)

    def delete_logo_preview_session(self, session_id: str) -> bool:
        """ロゴプレビューセッションを削除。

        Args:
            session_id: create_logo_preview_session() が返した sessionId
        """
        return self._delete(f"/api/logo/preview/sessions/{session_id}")

    # =========================================================================
    # 5-11. Trim調整系
    # =========================================================================


    # =========================================================================
    # 5-12. パスサジェスト系
    # =========================================================================

