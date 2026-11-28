"""キャプチャ（ライブ視聴・録画のキャプチャ画像）"""

from datetime import datetime
from typing import Optional
from .common import (  # noqa: F401
    UNCATEGORIZED_ALBUM_ID,
)
from .capture_links import _CaptureLinksMixin


class _CapturesMixin(_CaptureLinksMixin):
    """VideoDB の一部（キャプチャ（ライブ視聴・録画のキャプチャ画像））。"""

    # ------------------------------------------------------------------
    # captures（ライブ視聴/録画のキャプチャ画像）
    # ------------------------------------------------------------------
    def add_capture(self, path: str, *, video_id: Optional[int] = None,
                    recording_id: Optional[int] = None,
                    tot: Optional[str] = None,
                    onid: Optional[int] = None,
                    tsid: Optional[int] = None,
                    sid: Optional[int] = None,
                    eid: Optional[int] = None,
                    eit_title: Optional[str] = None,
                    eit_description: Optional[str] = None,
                    eit_extended_info: Optional[str] = None,
                    eit_start_time: Optional[str] = None,
                    eit_end_time: Optional[str] = None,
                    eit_station_name: Optional[str] = None,
                    owner: Optional[str] = None) -> int:
        """キャプチャ 1 件を登録する。

        ライブ取得時は video_id=None・recording_id=None。エンコード前の録画再生中の
        取得時は video_id=None・recording_id=rules.db側のrecording idを渡し、
        エンコード完了時に link_captures_by_recording() で video_id へ張り替える。
        戻り値: 登録した capture_id。path 重複時は既存 id を返す。
        """
        conn = self._get_conn()
        existing = conn.execute(
            "SELECT id FROM captures WHERE path = ?", (path,)).fetchone()
        if existing:
            return existing[0]
        now = datetime.now().isoformat()
        cur = conn.execute(
            "INSERT INTO captures(video_id, recording_id, path, tot, onid, tsid, sid, eid, "
            "eit_title, eit_description, eit_extended_info, eit_start_time, "
            "eit_end_time, eit_station_name, owner, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (video_id, recording_id, path, tot, onid, tsid, sid, eid,
             eit_title, eit_description, eit_extended_info,
             eit_start_time, eit_end_time, eit_station_name, owner, now, now))
        conn.commit()
        return cur.lastrowid

    def link_captures_by_recording(self, recording_id: int, video_id: int) -> int:
        """recording_idに紐づく未リンク(video_id未確定)のキャプチャをまとめてvideo_idへ
        張り替える。エンコード完了(run_file_copy)時に呼ぶ。戻り値は更新件数。"""
        conn = self._get_conn()
        cur = conn.execute(
            "UPDATE captures SET video_id=?, updated_at=? WHERE recording_id=? AND video_id IS NULL",
            (video_id, datetime.now().isoformat(), recording_id))
        conn.commit()
        return cur.rowcount

    # ── キャプチャと動画の相互照合 ───────────────────────────────────────
    # ファイルを別サーバーへ持ち込んで取り込み直す時に、
    #   キャプチャ登録 → 既存の動画を探して紐づける
    #   動画登録     → 既存の未紐づけキャプチャを探して紐づける
    # の両方向で繋がるようにする。番組の同一性は onid/tsid/sid/eid で判定し、
    # eid が無い(プログラム予約等)場合は sid + 放送時刻の重なりで見る。


    def get_captures(self, video_id: Optional[int] = None) -> list:
        """キャプチャ一覧（created_at 降順）。video_id 指定時はその録画分のみ。"""
        conn = self._get_conn()
        if video_id is None:
            rows = conn.execute(
                "SELECT * FROM captures ORDER BY created_at DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM captures WHERE video_id=? ORDER BY created_at DESC",
                (video_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_captures_index(self) -> list:
        """全キャプチャに所属アルバムを付けて新しい順で返す（ライブラリのキャプチャ一覧用）。

        videoに紐づいていないキャプチャ（録画完了前・手動配置）も返すので LEFT JOIN。
        """
        conn = self._get_conn()
        rows = conn.execute("""
            SELECT c.id, c.path, c.video_id, c.tot, c.eit_title, c.eit_station_name,
                   c.owner, c.created_at, s.album_id AS album_id, a.name AS album_name
            FROM captures c
            LEFT JOIN videos v ON c.video_id = v.id
            LEFT JOIN series s ON v.series_id = s.id
            LEFT JOIN albums a ON s.album_id = a.id
            ORDER BY c.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]

    def get_capture_by_path(self, path: str):
        row = self._get_conn().execute("SELECT * FROM captures WHERE path = ?", (path,)).fetchone()
        return dict(row) if row else None

    def get_captures_by_recording(self, recording_id: int) -> list:
        """recording_idに紐づく未リンク(video_id未確定)のキャプチャ一覧。
        federation pushでマスターへ転送する対象の収集に使う。"""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM captures WHERE recording_id=? AND video_id IS NULL",
            (recording_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_captures_for_album(self, album_id: int) -> list:
        """album内の全videoに紐づくキャプチャを新しい順で返す（ライブラリのキャプチャタブ用）。"""
        conn = self._get_conn()
        cond = "s.album_id IS NULL" if album_id == UNCATEGORIZED_ALBUM_ID else "s.album_id = ?"
        params = () if album_id == UNCATEGORIZED_ALBUM_ID else (album_id,)
        rows = conn.execute(f"""
            SELECT c.id, c.path, c.video_id, c.tot, c.eit_title, c.eit_station_name,
                   c.eit_start_time, c.owner, c.created_at, v.episode_number, v.episode_name,
                   s.id AS series_id, s.name AS series_name
            FROM captures c
            JOIN videos v ON c.video_id = v.id
            JOIN series s ON v.series_id = s.id
            WHERE {cond}
            ORDER BY c.created_at DESC
        """, params).fetchall()
        return [dict(r) for r in rows]

    def set_capture_video_id(self, capture_id: int, video_id: Optional[int]) -> bool:
        """キャプチャに video_id を紐付け（録画完了後の後付け）。更新成功で True。"""
        conn = self._get_conn()
        now = datetime.now().isoformat()
        cur = conn.execute(
            "UPDATE captures SET video_id=?, updated_at=? WHERE id=?",
            (video_id, now, capture_id))
        conn.commit()
        return cur.rowcount > 0

    def delete_capture(self, capture_id: int) -> bool:
        """キャプチャ行を削除（画像ファイルは別途削除）。削除成功で True。"""
        conn = self._get_conn()
        cur = conn.execute("DELETE FROM captures WHERE id=?", (capture_id,))
        conn.commit()
        return cur.rowcount > 0

    def delete_capture_by_path(self, path: str) -> bool:
        """path 一致のキャプチャ行を削除（画像ファイルは別途削除）。削除成功で True。"""
        conn = self._get_conn()
        cur = conn.execute("DELETE FROM captures WHERE path=?", (path,))
        conn.commit()
        return cur.rowcount > 0
