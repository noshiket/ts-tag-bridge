"""シリーズ・動画の並び（設定順）を動かす・控えて戻す"""

from datetime import datetime
from .common import UNCATEGORIZED_ALBUM_ID


def _swap_adjacent(ids: list, target, direction: str) -> bool:
    """ids の中の target を、direction('up'/'down')の隣と入れ替える。端なら何もせず False。"""
    idx = ids.index(target)
    if direction == 'up' and idx > 0:
        ids[idx - 1], ids[idx] = ids[idx], ids[idx - 1]
    elif direction == 'down' and idx < len(ids) - 1:
        ids[idx + 1], ids[idx] = ids[idx], ids[idx + 1]
    else:
        return False
    return True


def _write_order(conn, table: str, ids: list) -> None:
    """ids の並びどおりに sort_order を 0,1,2... と振り直して書き込む（table は series か videos）。"""
    assert table in ('series', 'videos')
    now = datetime.now().isoformat()
    for i, row_id in enumerate(ids):
        conn.execute(f"UPDATE {table} SET sort_order=?, updated_at=? WHERE id=?", (i, now, row_id))
    conn.commit()


class _VideoOrderMixin:
    """シリーズ・動画の並び（設定順）を動かす・控えて戻す"""

    def move_series(self, album_id: int, series_id: int, direction: str) -> bool:
        """album内のseries表示順を1つ上/下に入れ替える。呼び出しの都度、現在の表示順
        (sort_order, name, id)を基準に album 内全 series の sort_order を 0,1,2... に
        振り直した上で対象を隣接swapする（sort_order が未設定(全て0)のままでも安全に動作させるため）。"""
        conn = self._get_conn()
        acond = "album_id IS NULL" if album_id == UNCATEGORIZED_ALBUM_ID else "album_id=?"
        aparams = () if album_id == UNCATEGORIZED_ALBUM_ID else (album_id,)
        rows = conn.execute(
            f"SELECT id FROM series WHERE {acond} ORDER BY sort_order, name, id", aparams
        ).fetchall()
        ids = [r['id'] for r in rows]
        if series_id not in ids:
            return False
        if not _swap_adjacent(ids, series_id, direction):
            return False
        _write_order(conn, 'series', ids)
        return True

    def move_series_relative(self, album_id: int, series_id: int, ref_series_id: int, place: str) -> bool:
        """album内のseriesを別のseries(ref)の前/後へ移動する（ドラッグ&ドロップ/長押し移動用）。
        move_series と同様に現在の表示順基準で 0,1,2... に振り直してから挿入する。"""
        if place not in ('before', 'after') or series_id == ref_series_id:
            return False
        conn = self._get_conn()
        acond = "album_id IS NULL" if album_id == UNCATEGORIZED_ALBUM_ID else "album_id=?"
        aparams = () if album_id == UNCATEGORIZED_ALBUM_ID else (album_id,)
        rows = conn.execute(
            f"SELECT id FROM series WHERE {acond} ORDER BY sort_order, name, id", aparams
        ).fetchall()
        ids = [r['id'] for r in rows]
        if series_id not in ids or ref_series_id not in ids:
            return False
        ids.remove(series_id)
        ref_idx = ids.index(ref_series_id)
        ids.insert(ref_idx + (1 if place == 'after' else 0), series_id)
        _write_order(conn, 'series', ids)
        return True

    def move_video(self, series_id: int, video_id: int, direction: str) -> bool:
        """series内のvideo表示順を1つ上/下に入れ替える。move_seriesと同様、呼び出しの都度
        現在の表示順(sort_order, created_at, id)を基準に series 内全 video の sort_order を
        0,1,2... に振り直してから対象を隣接swapする。"""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id FROM videos WHERE series_id=? ORDER BY sort_order, created_at, id", (series_id,)
        ).fetchall()
        ids = [r['id'] for r in rows]
        if video_id not in ids:
            return False
        if not _swap_adjacent(ids, video_id, direction):
            return False
        _write_order(conn, 'videos', ids)
        return True

    def snapshot_album_manual(self, album_id: int) -> dict:
        """アルバムの手動設定（シリーズのサムネ/並び順、アルバムの説明/並び順）を控える。

        フォルダ一括変更は video を登録し直すため series / album の id が変わる。
        id に紐づく手動設定はそのままだと失われるので、名前をキーに控えて後で戻す。
        """
        conn = self._get_conn()
        album = conn.execute("SELECT * FROM albums WHERE id=?", (album_id,)).fetchone()
        rows = conn.execute(
            "SELECT name, thumbnail_path, sort_order FROM series WHERE album_id=?",
            (album_id,)).fetchall()
        return {
            'album': ({'description': album['description'], 'sort_order': album['sort_order']}
                      if album else None),
            'series': {r['name']: {'thumbnail_path': r['thumbnail_path'],
                                   'sort_order': r['sort_order']} for r in rows},
        }

    def restore_album_manual(self, album_id: int, snap: dict) -> int:
        """snapshot_album_manual() の内容を新しいアルバムへ戻す。戻せた series 数を返す。"""
        if not snap:
            return 0
        conn = self._get_conn()
        now = datetime.now().isoformat()
        alb = snap.get('album') or {}
        if alb:
            conn.execute("UPDATE albums SET description=?, sort_order=?, updated_at=? WHERE id=?",
                         (alb.get('description'), alb.get('sort_order') or 0, now, album_id))
        n = 0
        for name, v in (snap.get('series') or {}).items():
            if not (v.get('thumbnail_path') or v.get('sort_order')):
                continue
            cur = conn.execute(
                "UPDATE series SET thumbnail_path=COALESCE(?, thumbnail_path), "
                "sort_order=?, updated_at=? WHERE album_id=? AND name=?",
                (v.get('thumbnail_path'), v.get('sort_order') or 0, now, album_id, name))
            n += cur.rowcount
        conn.commit()
        return n
