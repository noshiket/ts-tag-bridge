"""プレイリストと音楽のお気に入り"""

from datetime import datetime
from typing import Optional


class _PlaylistsMixin:
    """UsersDB の一部（プレイリストと音楽のお気に入り）。"""

    # ── watch_history ──────────────────────────────────────────────────

    # ── マイリスト ────────────────────────────────────────────────────
    # ── ミュージック: プレイリスト / お気に入り ──────────────────────────
    def list_playlists(self, user_id: int) -> list:
        """プレイリスト（フォルダ含む）を曲数付きで返す。"""
        with self._conn() as c:
            rows = c.execute("""
                SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id)
                       AS item_count
                FROM playlists p WHERE p.user_id = ?
                ORDER BY p.updated_at DESC
            """, (user_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_playlist(self, user_id: int, playlist_id: int) -> Optional[dict]:
        with self._conn() as c:
            r = c.execute('SELECT * FROM playlists WHERE id=? AND user_id=?',
                          (playlist_id, user_id)).fetchone()
        return dict(r) if r else None

    def create_playlist(self, user_id: int, name: str, kind: str = 'playlist',
                        parent_id: Optional[int] = None) -> int:
        with self._conn() as c:
            cur = c.execute(
                'INSERT INTO playlists (user_id, name, kind, parent_id) VALUES (?,?,?,?)',
                (user_id, name, 'folder' if kind == 'folder' else 'playlist', parent_id))
            return cur.lastrowid

    def update_playlist(self, user_id: int, playlist_id: int, **fields) -> bool:
        allowed = {k: v for k, v in fields.items() if k in ('name', 'parent_id')}
        if not allowed:
            return False
        allowed['updated_at'] = datetime.utcnow().isoformat()
        sets = ', '.join(f'{k}=?' for k in allowed)
        with self._conn() as c:
            cur = c.execute(f'UPDATE playlists SET {sets} WHERE id=? AND user_id=?',
                            list(allowed.values()) + [playlist_id, user_id])
            return cur.rowcount > 0

    def delete_playlist(self, user_id: int, playlist_id: int) -> bool:
        with self._conn() as c:
            cur = c.execute('DELETE FROM playlists WHERE id=? AND user_id=?',
                            (playlist_id, user_id))
            return cur.rowcount > 0

    def playlist_video_ids(self, user_id: int, playlist_id: int) -> list:
        """並び順の video_id 一覧（そのユーザーのプレイリストでなければ空）。"""
        with self._conn() as c:
            if not c.execute('SELECT 1 FROM playlists WHERE id=? AND user_id=?',
                             (playlist_id, user_id)).fetchone():
                return []
            rows = c.execute('SELECT video_id FROM playlist_items WHERE playlist_id=? '
                             'ORDER BY sort_order, id', (playlist_id,)).fetchall()
        return [r['video_id'] for r in rows]

    def add_playlist_items(self, user_id: int, playlist_id: int, video_ids: list) -> int:
        """末尾に足す（既に入っている曲は無視）。戻り値は実際に足した数。"""
        with self._conn() as c:
            if not c.execute('SELECT 1 FROM playlists WHERE id=? AND user_id=?',
                             (playlist_id, user_id)).fetchone():
                return 0
            base = c.execute('SELECT COALESCE(MAX(sort_order), -1) FROM playlist_items '
                             'WHERE playlist_id=?', (playlist_id,)).fetchone()[0]
            n = 0
            for i, vid in enumerate(video_ids):
                cur = c.execute('INSERT OR IGNORE INTO playlist_items '
                                '(playlist_id, video_id, sort_order) VALUES (?,?,?)',
                                (playlist_id, int(vid), base + 1 + i))
                n += cur.rowcount
            c.execute('UPDATE playlists SET updated_at=? WHERE id=?',
                      (datetime.utcnow().isoformat(), playlist_id))
            return n

    def remove_playlist_item(self, user_id: int, playlist_id: int, video_id: int) -> bool:
        with self._conn() as c:
            if not c.execute('SELECT 1 FROM playlists WHERE id=? AND user_id=?',
                             (playlist_id, user_id)).fetchone():
                return False
            cur = c.execute('DELETE FROM playlist_items WHERE playlist_id=? AND video_id=?',
                            (playlist_id, int(video_id)))
            c.execute('UPDATE playlists SET updated_at=? WHERE id=?',
                      (datetime.utcnow().isoformat(), playlist_id))
            return cur.rowcount > 0

    def move_playlist_item(self, user_id: int, playlist_id: int, video_id: int,
                           direction: str) -> bool:
        """プレイリスト内の曲を1つ上/下へ動かす（隣と sort_order を入れ替える）。"""
        with self._conn() as c:
            if not c.execute('SELECT 1 FROM playlists WHERE id=? AND user_id=?',
                             (playlist_id, user_id)).fetchone():
                return False
            rows = c.execute('SELECT id, video_id FROM playlist_items WHERE playlist_id=? '
                             'ORDER BY sort_order, id', (playlist_id,)).fetchall()
            order = [r['video_id'] for r in rows]
            i = order.index(int(video_id)) if int(video_id) in order else -1
            j = i + (-1 if direction == 'up' else 1)
            if i < 0 or j < 0 or j >= len(order):
                return False
            order[i], order[j] = order[j], order[i]
            # 端数の詰まりを避けるため、動かした後に 0..n で振り直す
            for k, vid in enumerate(order):
                c.execute('UPDATE playlist_items SET sort_order=? WHERE playlist_id=? AND video_id=?',
                          (k, playlist_id, vid))
            c.execute('UPDATE playlists SET updated_at=? WHERE id=?',
                      (datetime.utcnow().isoformat(), playlist_id))
            return True

    def touch_playlist_played(self, user_id: int, playlist_id: int) -> None:
        with self._conn() as c:
            c.execute('UPDATE playlists SET last_played_at=? WHERE id=? AND user_id=?',
                      (datetime.utcnow().isoformat(), playlist_id, user_id))

    def list_music_favorites(self, user_id: int) -> list:
        with self._conn() as c:
            rows = c.execute('SELECT video_id FROM music_favorites WHERE user_id=? '
                             'ORDER BY created_at DESC', (user_id,)).fetchall()
        return [r['video_id'] for r in rows]

    def set_music_favorite(self, user_id: int, video_id: int, on: bool) -> None:
        with self._conn() as c:
            if on:
                c.execute('INSERT OR IGNORE INTO music_favorites (user_id, video_id) VALUES (?,?)',
                          (user_id, int(video_id)))
            else:
                c.execute('DELETE FROM music_favorites WHERE user_id=? AND video_id=?',
                          (user_id, int(video_id)))
