"""動画とアルバム・カテゴリの対応（まとめて引く）"""

from typing import List
from .common import UNCATEGORIZED_ALBUM_ID


class _AlbumCategoriesMixin:
    """動画とアルバム・カテゴリの対応（まとめて引く）"""

    def get_video_album_map(self) -> dict:
        """全videoについて video_id -> album_id のマッピングを返す（視聴履歴(users.db)側の
        video_id集合をalbum単位に集約する際、video.db側で使う）。"""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT v.id AS video_id, s.album_id AS album_id FROM videos v "
            "JOIN series s ON v.series_id = s.id WHERE s.album_id IS NOT NULL"
        ).fetchall()
        return {r['video_id']: r['album_id'] for r in rows}

    def get_episode_rows(self, album_ids) -> list:
        """アルバムの新着の判定用: 指定アルバムの動画ごとの話数・局・放送開始・追加日時"""
        ids = list(album_ids)
        if not ids:
            return []
        conn = self._get_conn()
        ph = ','.join('?' * len(ids))
        rows = conn.execute(
            "SELECT v.id AS video_id, v.series_id AS series_id, s.album_id AS album_id, v.episode_number AS episode_number, v.onid AS onid, v.sid AS sid, "
            "COALESCE(v.eit_start_time, v.recording_start_time, v.created_at) AS start, v.created_at AS created_at "
            f"FROM videos v JOIN series s ON v.series_id = s.id WHERE s.album_id IN ({ph})", ids,
        ).fetchall()
        return [dict(r) for r in rows]

    def _cats_batch(self, conn, node_type: str, ids: List[int]) -> dict:
        """指定node_type配下の複数node_idについて、それぞれに直接リンクされたカテゴリ
        ({id,name}のリスト)をnode_id単位でまとめて返す。"""
        if not ids:
            return {}
        ph = ','.join('?' * len(ids))
        rows = conn.execute(
            f"SELECT cn.node_id AS node_id, c.id AS cat_id, c.name AS cat_name "
            f"FROM category_nodes cn JOIN categories c ON c.id = cn.category_id "
            f"WHERE cn.node_type=? AND cn.node_id IN ({ph})", (node_type, *ids)
        ).fetchall()
        out = {}
        for r in rows:
            out.setdefault(r['node_id'], []).append({'id': r['cat_id'], 'name': r['cat_name']})
        return out

    def get_video_categories_map(self, album_id: int) -> dict:
        """album内の各videoに実効的に適用されるカテゴリ({id,name}のリスト)をvideo_id単位で
        返す。フロンティア方式(category_nodesはvideo/series/albumいずれか1階層にのみ
        リンクされる)に従い、video自身のnode→series→albumの順に最初に見つかったレベルの
        カテゴリを採用する。"""
        conn = self._get_conn()
        if album_id == UNCATEGORIZED_ALBUM_ID:
            series_rows = conn.execute("SELECT id FROM series WHERE album_id IS NULL").fetchall()
        else:
            series_rows = conn.execute("SELECT id FROM series WHERE album_id=?", (album_id,)).fetchall()
        series_ids = [r['id'] for r in series_rows]
        video_rows = []
        if series_ids:
            ph = ','.join('?' * len(series_ids))
            video_rows = conn.execute(
                f"SELECT id, series_id FROM videos WHERE series_id IN ({ph})", series_ids
            ).fetchall()
        video_ids = [v['id'] for v in video_rows]

        video_cats = self._cats_batch(conn, 'video', video_ids)
        series_cats = self._cats_batch(conn, 'series', series_ids)
        album_cats = self._cats_batch(conn, 'album', [album_id]).get(album_id, [])

        result = {}
        for v in video_rows:
            vid = v['id']
            if vid in video_cats:
                result[vid] = video_cats[vid]
            elif v['series_id'] in series_cats:
                result[vid] = series_cats[v['series_id']]
            else:
                result[vid] = album_cats
        return result

    def attach_categories(self, items) -> list:
        """任意の video 行リストへ実効カテゴリを 'categories' として付ける。

        get_video_categories_map はアルバム単位なので、album 横断の一覧
        (ビデオ表示・カード取得)では使えない。渡された行だけを対象に、
        video → series → album の順で最初に見つかった階層のカテゴリを採用する
        (フロンティア方式。get_video_categories_map と同じ規則)。
        """
        rows = list(items or [])
        if not rows:
            return rows
        conn = self._get_conn()
        vids = [r['id'] for r in rows]
        sids = sorted({r.get('series_id') for r in rows if r.get('series_id') is not None})
        aids = sorted({r.get('album_id') for r in rows if r.get('album_id') is not None})
        vcats = self._cats_batch(conn, 'video', vids)
        scats = self._cats_batch(conn, 'series', sids)
        acats = self._cats_batch(conn, 'album', aids)
        for r in rows:
            r['categories'] = (vcats.get(r['id'])
                               or scats.get(r.get('series_id'))
                               or acats.get(r.get('album_id'))
                               or [])
        return rows
