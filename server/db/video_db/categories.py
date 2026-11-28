"""カテゴリの整合（フロンティア・付け替え）"""

from datetime import datetime
from typing import Optional, List, Set


class _CategoriesMixin:
    """VideoDB の一部（カテゴリの整合（フロンティア・付け替え））。"""

    # ------------------------------------------------------------------
    # category_nodes フロンティア整合
    # ------------------------------------------------------------------
    def _reconcile_categories(self, conn, video_id: int, series_id: Optional[int],
                              album_id: Optional[int], c_set: Set[int]) -> None:
        # series を持たない video は単独 → category を video へ直接紐付け
        if series_id is None:
            for c in c_set:
                self._link(conn, c, 'video', video_id)
            return

        # 帰属が変わり得る category = C_set ∪ album/series に現在 link 済みの category
        aff = set(c_set)
        if album_id is not None:
            aff |= self._cats_linked_to(conn, 'album', album_id)
        aff |= self._cats_linked_to(conn, 'series', series_id)

        for c in aff:
            self._recompute_frontier(conn, c, album_id, series_id, video_id, c in c_set)

    def _recompute_frontier(self, conn, category_id: int, album_id: Optional[int],
                            series_id: int, new_video_id: int, new_in_c: bool) -> None:
        # スコープ内の (video_id, series_id) を収集
        if album_id is not None:
            rows = conn.execute(
                "SELECT v.id, v.series_id FROM videos v "
                "JOIN series s ON v.series_id = s.id WHERE s.album_id = ?",
                (album_id,)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, series_id FROM videos WHERE series_id = ?",
                (series_id,)).fetchall()
        rows = [(r[0], r[1]) for r in rows]
        if not rows:
            return

        # 帰属を確定（link クリア前に算出）
        member = {}
        for vid, sid in rows:
            if vid == new_video_id:
                member[vid] = new_in_c
            else:
                member[vid] = self._video_in_category(conn, vid, sid, album_id, category_id)

        series_ids = sorted({sid for _, sid in rows})
        video_ids = [v for v, _ in rows]
        self._clear_category_in_scope(conn, category_id, album_id, series_ids, video_ids)

        # フロンティア再構築: 全 video が属する最上位ノードへ
        if album_id is not None and all(member.values()):
            self._link(conn, category_id, 'album', album_id)
            return
        for sid in series_ids:
            svids = [v for v, s in rows if s == sid]
            if svids and all(member[v] for v in svids):
                self._link(conn, category_id, 'series', sid)
            else:
                for v in svids:
                    if member[v]:
                        self._link(conn, category_id, 'video', v)

    def _video_in_category(self, conn, video_id: int, series_id: Optional[int],
                           album_id: Optional[int], category_id: int) -> bool:
        q = ("SELECT 1 FROM category_nodes WHERE category_id=? "
             "AND (node_type='video' AND node_id=?")
        params = [category_id, video_id]
        if series_id is not None:
            q += " OR node_type='series' AND node_id=?"
            params.append(series_id)
        if album_id is not None:
            q += " OR node_type='album' AND node_id=?"
            params.append(album_id)
        q += ") LIMIT 1"
        return conn.execute(q, params).fetchone() is not None

    def _cats_linked_to(self, conn, node_type: str, node_id: int) -> Set[int]:
        return {r[0] for r in conn.execute(
            "SELECT DISTINCT category_id FROM category_nodes WHERE node_type=? AND node_id=?",
            (node_type, node_id)).fetchall()}

    def _clear_category_in_scope(self, conn, category_id: int, album_id: Optional[int],
                                 series_ids: List[int], video_ids: List[int]) -> None:
        if album_id is not None:
            conn.execute("DELETE FROM category_nodes WHERE category_id=? "
                         "AND node_type='album' AND node_id=?", (category_id, album_id))
        if series_ids:
            ph = ','.join('?' * len(series_ids))
            conn.execute(f"DELETE FROM category_nodes WHERE category_id=? "
                         f"AND node_type='series' AND node_id IN ({ph})",
                         (category_id, *series_ids))
        if video_ids:
            ph = ','.join('?' * len(video_ids))
            conn.execute(f"DELETE FROM category_nodes WHERE category_id=? "
                         f"AND node_type='video' AND node_id IN ({ph})",
                         (category_id, *video_ids))

    def _link(self, conn, category_id: int, node_type: str, node_id: int) -> None:
        conn.execute(
            "INSERT INTO category_nodes(category_id, node_type, node_id) VALUES(?,?,?) "
            "ON CONFLICT(category_id, node_type, node_id) DO NOTHING",
            (category_id, node_type, node_id))

    def update_video_categories(self, video_id: int, category_names) -> bool:
        """既存 video のカテゴリ(category_nodes)を新カテゴリ名リストへ更新する。
        確定値編集(tag.json)後に DB(ライブラリのカテゴリ表示)へ即反映するため。
        add_videos と同じフロンティア整合ロジックを再利用し、追加・除去とも扱う。"""
        conn = self._get_conn()
        now = datetime.now().isoformat()
        row = conn.execute(
            "SELECT v.series_id, s.album_id FROM videos v "
            "LEFT JOIN series s ON v.series_id = s.id WHERE v.id=?", (video_id,)).fetchone()
        if row is None:
            return False
        series_id, album_id = row[0], row[1]
        if isinstance(category_names, str):
            category_names = [category_names]
        c_set: Set[int] = set()
        for name in (category_names or []):
            if name:
                c_set.add(self._upsert_category(conn, name, now))
        try:
            if series_id is None:
                # series を持たない単独 video: video 直リンクのみ。除去は明示削除。
                cur = self._cats_linked_to(conn, 'video', video_id)
                for c in (cur - c_set):
                    conn.execute(
                        "DELETE FROM category_nodes WHERE category_id=? AND node_type='video' AND node_id=?",
                        (c, video_id))
                for c in c_set:
                    self._link(conn, c, 'video', video_id)
            else:
                # 帰属が変わり得る category = 新c_set ∪ この video の現video-levelリンク
                # ∪ album/series に現在link済み。除去(video-levelのみ)も確実に再整合される。
                aff = set(c_set) | self._cats_linked_to(conn, 'video', video_id)
                if album_id is not None:
                    aff |= self._cats_linked_to(conn, 'album', album_id)
                aff |= self._cats_linked_to(conn, 'series', series_id)
                for c in aff:
                    self._recompute_frontier(conn, c, album_id, series_id, video_id, c in c_set)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return True
