"""動画・サムネのファイルの場所（拾い直し・新しい順・代表のサムネ）"""

import os
import json
import sqlite3
from datetime import datetime
from typing import Optional, List
from .common import UNCATEGORIZED_ALBUM_ID


class _VideoFilesMixin:
    """動画・サムネのファイルの場所（拾い直し・新しい順・代表のサムネ）"""

    def iter_video_paths(self):
        """(id, file_path) だけを id 降順で返す軽量な一覧。

        一括処理(フレーム表の後付け等)用。list_videos は表示用に多数の結合と
        集計をするため全件だと数分かかる(実測200秒/12,256本)。
        """
        rows = self._get_conn().execute(
            "SELECT id, file_path, frame_table IS NOT NULL AS has_frame_table "
            "FROM videos ORDER BY id DESC").fetchall()
        return [{'id': r['id'], 'file_path': r['file_path'],
                 'has_frame_table': bool(r['has_frame_table'])} for r in rows]

    def set_frame_table(self, video_id: int, table) -> None:
        """フレーム表を videos.frame_table へ入れる（tag.json からの後付け用）。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET frame_table=?, updated_at=? WHERE id=?",
                     (json.dumps(table, ensure_ascii=False) if isinstance(table, (dict, list)) else table,
                      datetime.now().isoformat(), video_id))
        conn.commit()

    def get_video_thumbnail(self, video_id: int) -> Optional[str]:
        """video の thumbnail_path を返す（ファイルが存在しない場合は None）。"""
        conn = self._get_conn()
        row = conn.execute("SELECT thumbnail_path FROM videos WHERE id=?", (video_id,)).fetchone()
        if not row or not row[0]:
            return None
        return row[0] if os.path.exists(row[0]) else None

    @staticmethod
    def _find_moved_file(stale_path: Optional[str]) -> Optional[str]:
        """移動により実体が失われた絶対パスを、現在マウントされている各所から探して返す。
        末尾サブパス（最低でも親フォルダ+ファイル名）を長い方から一致させ、実在するものを返す。
        マウントプレフィックスだけが変わった移動（/mnt/A/... → /mnt/B/A/... 等）に追従する。"""
        if not stale_path:
            return None
        try:
            with open('/proc/mounts') as f:
                mounts = sorted({line.split()[1] for line in f}, key=len, reverse=True)
        except OSError:
            return None
        mounts = [m for m in mounts if not m.startswith(('/proc', '/sys', '/dev', '/run'))]
        parts = [p for p in stale_path.split('/') if p]
        for i in range(len(parts) - 1):          # i=0 が最長 suffix（誤検出防止のため親フォルダ+ファイル名を最低保証）
            suffix = '/'.join(parts[i:])
            for m in mounts:
                cand = m.rstrip('/') + '/' + suffix
                if os.path.exists(cand):
                    return cand
        return None

    def heal_video_paths(self, video_id: int) -> bool:
        """video のファイル/サムネのパス列(file_path/thumbnail_path/thumbnail_tile_path)のうち
        実体が失われているものを、現在のマウント先から探して DB を更新する（外部でのファイル移動に追従）。
        1列でも更新できれば True。"""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT file_path, thumbnail_path, thumbnail_tile_path FROM videos WHERE id=?",
            (video_id,)).fetchone()
        if row is None:
            return False
        updates = {}
        for col in ('file_path', 'thumbnail_path', 'thumbnail_tile_path'):
            p = row[col]
            if p and not os.path.exists(p):
                found = self._find_moved_file(p)
                if found and found != p:
                    updates[col] = found
        if not updates:
            return False
        cols = list(updates)

        def _apply(target_cols):
            conn.execute(
                f"UPDATE videos SET {', '.join(c + '=?' for c in target_cols)}, updated_at=? WHERE id=?",
                (*[updates[c] for c in target_cols], datetime.now().isoformat(), video_id))
            conn.commit()
        try:
            _apply(cols)
        except sqlite3.IntegrityError:
            # file_path の UNIQUE 衝突等。file_path を除いてサムネだけでも更新する
            conn.rollback()
            cols = [c for c in cols if c != 'file_path']
            if not cols:
                return False
            _apply(cols)
        return True

    def get_album_latest_thumbnail(self, album_id: int) -> Optional[str]:
        """album 内の最新 video の thumbnail_path を返す（ファイルが存在しない場合は None）。"""
        conn = self._get_conn()
        cond = "s.album_id IS NULL" if album_id == UNCATEGORIZED_ALBUM_ID else "s.album_id = ?"
        params = () if album_id == UNCATEGORIZED_ALBUM_ID else (album_id,)
        rows = conn.execute(f"""
            SELECT v.thumbnail_path
            FROM videos v
            JOIN series s ON v.series_id = s.id
            WHERE {cond}
            ORDER BY v.created_at DESC
        """, params).fetchall()
        for row in rows:
            p = row[0]
            if p and os.path.exists(p):
                return p
        return None

    def get_video_paths_newest_first(self, series_id: int = None, album_id: int = None) -> List[str]:
        """series か album に入っている video の file_path を新しい順に返す（ジャケット探し用）。"""
        conn = self._get_conn()
        if series_id is not None:
            rows = conn.execute("SELECT file_path FROM videos WHERE series_id = ? "
                                "ORDER BY created_at DESC", (series_id,)).fetchall()
        else:
            cond = "s.album_id IS NULL" if album_id == UNCATEGORIZED_ALBUM_ID else "s.album_id = ?"
            params = () if album_id == UNCATEGORIZED_ALBUM_ID else (album_id,)
            rows = conn.execute(f"SELECT v.file_path FROM videos v JOIN series s ON v.series_id = s.id "
                                f"WHERE {cond} ORDER BY v.created_at DESC", params).fetchall()
        return [r[0] for r in rows if r[0]]

    def get_series_latest_thumbnail(self, series_id: int) -> Optional[str]:
        """series 内の最新 video の thumbnail_path を返す（無ければ None）。

        series 自体にサムネを設定していない時の代役。音楽はアルバム(series)の
        ジャケットが各曲のサムネに入っているので、これで実際のジャケットが出る。
        """
        conn = self._get_conn()
        rows = conn.execute("""
            SELECT thumbnail_path FROM videos
            WHERE series_id = ?
            ORDER BY created_at DESC
        """, (series_id,)).fetchall()
        for row in rows:
            p = row[0]
            if p and os.path.exists(p):
                return p
        return None

    def set_series_thumbnail(self, series_id: int, thumbnail_path: str) -> bool:
        """series のサムネイルパスを更新する（キャプチャからの設定用）。更新成功でTrue。"""
        conn = self._get_conn()
        now = datetime.now().isoformat()
        cur = conn.execute(
            "UPDATE series SET thumbnail_path=?, updated_at=? WHERE id=?",
            (thumbnail_path, now, series_id))
        conn.commit()
        return cur.rowcount > 0
