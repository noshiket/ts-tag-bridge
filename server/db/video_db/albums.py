"""アルバム・カテゴリの一覧と詳細"""

import os
from typing import Optional, Set
from .common import UNCATEGORIZED_ALBUM_ID, UNCATEGORIZED_ALBUM_NAME  # noqa: F401
from .music_albums import _fs_fold  # noqa: F401
from .album_list import _AlbumListMixin
from .album_categories import _AlbumCategoriesMixin


class _AlbumsMixin(_AlbumListMixin, _AlbumCategoriesMixin):
    """VideoDB の一部（アルバム・カテゴリの一覧と詳細）。"""


    def get_album_detail(self, album_id: int, private_categories=None) -> Optional[dict]:
        """album の series と各 series 配下の video 一覧（created_at 降順）を返す。
        各videoにはget_video_categories_map()で解決した実効カテゴリを'categories'として付与する。"""
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        if album_id == UNCATEGORIZED_ALBUM_ID:
            # 仮想アルバム「未分類」= フォルダ未設定(album_id IS NULL)の series 群
            album = {'id': UNCATEGORIZED_ALBUM_ID, 'name': UNCATEGORIZED_ALBUM_NAME,
                     'description': None, 'created_at': None, 'updated_at': None}
            series_rows = conn.execute(
                "SELECT * FROM series WHERE album_id IS NULL ORDER BY sort_order, name"
            ).fetchall()
        else:
            album = conn.execute("SELECT * FROM albums WHERE id=?", (album_id,)).fetchone()
            if not album:
                return None
            series_rows = conn.execute(
                "SELECT * FROM series WHERE album_id=? ORDER BY sort_order, name", (album_id,)
            ).fetchall()
        cat_map = self.get_video_categories_map(album_id)
        result = dict(album)
        result['series'] = []
        for s in series_rows:
            sd = dict(s)
            videos = conn.execute(f"""
                SELECT id, eit_title, episode_number, episode_name,
                       duration_sec, file_size, created_at, updated_at,
                       thumbnail_path, eit_start_time, COALESCE(has_caption, 0) AS has_caption, (CASE WHEN captions3_json IS NOT NULL AND captions3_json NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_added_caption, COALESCE(added_comment_tracks, 0) AS added_comment_tracks, COALESCE(max_comment_count, comment_count) AS max_comment_count, 
                       comment_count, file_path, onid, sid, eit_station_name, drop_error,
                       recording_start_time, eit_audio_info, setting, sort_order, announce,
                       allow_duplicate, has_secondary_audio, media_kind, artist, video_codec
                FROM videos v WHERE series_id=?{priv}
                ORDER BY CASE WHEN media_kind='audio' THEN sort_order END ASC, created_at DESC
            """, (s['id'],)).fetchall()
            vlist = [dict(v) for v in videos]
            for v in vlist:
                v['categories'] = cat_map.get(v['id'], [])
                # 分類エラー: この動画が置かれているフォルダ名がアルバム名と違う。
                # アルバム一覧の folder_mismatch と同じ判定で、どの動画かを特定できる
                folder = os.path.basename(os.path.dirname(v.get('file_path') or ''))
                v['folder'] = folder
                # 音楽は album がアーティスト名で、ファイルはアルバムのフォルダに
                # 置かれるため必ず食い違う（_album_folder_map と同じ理由で対象外）
                v['folder_mismatch'] = bool(
                    v.get('media_kind') != 'audio'
                    and folder and _fs_fold(folder) != _fs_fold(result.get('name') or ''))
            sd['videos'] = vlist
            result['series'].append(sd)
        return result

    def get_category_videos(self, category_id: int, private_categories=None) -> Optional[dict]:
        """カテゴリに実効的に属する全videoをalbum横断で返す（フロンティア＝video/series/album
        いずれかのcategory_nodesから辿り、videoレベルまで展開する）。各videoにどのalbum/series
        由来かを付与する。"""
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        cat = conn.execute("SELECT * FROM categories WHERE id=?", (category_id,)).fetchone()
        if not cat:
            return None
        nodes = conn.execute(
            "SELECT node_type, node_id FROM category_nodes WHERE category_id=?", (category_id,)
        ).fetchall()
        video_ids: Set[int] = set()
        series_ids: Set[int] = set()
        album_ids: Set[int] = set()
        for n in nodes:
            if n['node_type'] == 'video':
                video_ids.add(n['node_id'])
            elif n['node_type'] == 'series':
                series_ids.add(n['node_id'])
            elif n['node_type'] == 'album':
                album_ids.add(n['node_id'])

        if album_ids:
            ph = ','.join('?' * len(album_ids))
            rows = conn.execute(f"SELECT id FROM series WHERE album_id IN ({ph})", list(album_ids)).fetchall()
            series_ids |= {r['id'] for r in rows}
        if series_ids:
            ph = ','.join('?' * len(series_ids))
            rows = conn.execute(f"SELECT id FROM videos WHERE series_id IN ({ph})", list(series_ids)).fetchall()
            video_ids |= {r['id'] for r in rows}

        videos = []
        if video_ids:
            ph = ','.join('?' * len(video_ids))
            rows = conn.execute(f"""
                SELECT v.id, v.eit_title, v.episode_number, v.episode_name, v.duration_sec,
                       v.file_size, v.created_at, v.updated_at, v.thumbnail_path, v.eit_start_time,
                       COALESCE(v.has_caption, 0) AS has_caption, (CASE WHEN v.captions3_json IS NOT NULL AND v.captions3_json NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_added_caption, COALESCE(v.added_comment_tracks, 0) AS added_comment_tracks, COALESCE(v.max_comment_count, v.comment_count) AS max_comment_count, v.comment_count, v.file_path, v.onid,
                       v.sid, v.tsid, v.eid, v.eit_station_name, v.drop_error, v.recording_start_time,
                       v.eit_audio_info, v.setting, v.sort_order, v.announce, v.allow_duplicate,
                       v.has_secondary_audio, v.media_kind, v.artist, v.video_codec,
                       v.series_id, s.name AS series_name, s.album_id AS album_id, a.name AS album_name
                FROM videos v
                LEFT JOIN series s ON v.series_id = s.id
                LEFT JOIN albums a ON s.album_id = a.id
                WHERE v.id IN ({ph}){priv}
                ORDER BY v.created_at DESC
            """, list(video_ids)).fetchall()
            videos = [dict(r) for r in rows]
        return {'id': cat['id'], 'name': cat['name'], 'videos': videos}

    def get_videos_by_momentum(self, cutoff_iso: str, page: int = 0, per_page: int = 20,
                               private_categories=None) -> dict:
        """コメント勢い(comment_count / (duration_sec/60))が大きい順にvideoをalbum横断で返す。
        VideoRow(encode.jsx)のコメント勢い表示と同じ式で算出する。cutoff_iso以降に放送
        (recording_start_time、無ければcreated_at)されたvideoのみが対象。"""
        conn = self._get_conn()
        where = ("v.comment_count > 0 AND v.duration_sec > 0 "
                 "AND COALESCE(v.recording_start_time, v.created_at) >= ?"
                 + self.private_filter_sql('v', private_categories))
        total = conn.execute(f"SELECT COUNT(*) FROM videos v WHERE {where}", (cutoff_iso,)).fetchone()[0]
        rows = conn.execute(f"""
            SELECT v.id, v.eit_title, v.episode_number, v.episode_name, v.duration_sec,
                   v.file_size, v.created_at, v.updated_at, v.thumbnail_path, v.eit_start_time,
                   COALESCE(v.has_caption, 0) AS has_caption, (CASE WHEN v.captions3_json IS NOT NULL AND v.captions3_json NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_added_caption, COALESCE(v.added_comment_tracks, 0) AS added_comment_tracks, COALESCE(v.max_comment_count, v.comment_count) AS max_comment_count, v.comment_count, v.file_path, v.onid,
                   v.sid, v.tsid, v.eid, v.eit_station_name, v.drop_error, v.recording_start_time,
                   v.eit_audio_info, v.setting, v.sort_order, v.announce, v.allow_duplicate,
                   v.has_secondary_audio, v.media_kind, v.artist, v.video_codec,
                   v.series_id, s.name AS series_name, s.album_id AS album_id, a.name AS album_name,
                   (v.comment_count * 60.0 / v.duration_sec) AS velocity
            FROM videos v
            LEFT JOIN series s ON v.series_id = s.id
            LEFT JOIN albums a ON s.album_id = a.id
            WHERE {where}
            ORDER BY velocity DESC
            LIMIT ? OFFSET ?
        """, (cutoff_iso, per_page, page * per_page)).fetchall()
        return {'items': [dict(r) for r in rows], 'total': total, 'page': page, 'per_page': per_page}
