"""音楽・カード・動画の更新と削除"""

from datetime import datetime
from typing import Optional, List
from .music_albums import _merge_music_albums  # noqa: F401
from .common import caption_flag, comment_track_stats, drop_scramble_counts  # noqa: F401


class _EditsMixin:
    """VideoDB の一部（音楽・カード・動画の更新と削除）。"""

    def get_music_albums(self, private_categories=None) -> list:
        """音楽のアルバム(series)一覧。アーティスト名・曲数・年・追加日を付ける。

        音楽は album=アーティスト / series=アルバム / video=曲 で入っている。
        年は取り込み時にタグの date を eit_start_time へ入れているのでそこから採る。

        同じアルバムがアーティスト違いで割れているものは1枚に束ねる（客演で
        album_artist が変わると別アーティスト＝別 series になるため。実例:
        'Gems' が Band と Band & Guest Singer、'歌い手のベスト [Disc 2]' が
        歌い手 と 歌い手 with 合成音声）。判定は _merge_music_albums を参照。
        """
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        rows = conn.execute(f"""
            SELECT s.id            AS series_id,
                   s.name          AS name,
                   s.thumbnail_path AS thumbnail_path,
                   a.id            AS album_id,
                   a.name          AS artist,
                   COUNT(v.id)     AS track_count,
                   MIN(v.eit_start_time) AS year_at,
                   MAX(v.created_at)     AS added_at,
                   MAX(v.updated_at)     AS updated_at,
                   MIN(v.music_key)      AS music_key
            FROM series s
            JOIN albums a ON a.id = s.album_id
            JOIN videos v ON v.series_id = s.id
            WHERE v.media_kind = 'audio'{priv}
            GROUP BY s.id
        """).fetchall()
        return _merge_music_albums([dict(r) for r in rows])

    def get_music_track_ids(self, sort: str = 'title', private_categories=None) -> list:
        """音楽の曲 id を指定順で返す（カードは get_video_cards で引く）。

        sort: title(曲名) / added(追加が新しい順) / artist(アーティスト→アルバム→トラック番号)
        """
        order = {
            'added':  'v.created_at DESC, v.id DESC',
            'artist': 'a.name COLLATE NOCASE, s.name COLLATE NOCASE, v.episode_number, v.id',
        }.get(sort, "COALESCE(NULLIF(v.episode_name, ''), v.eit_title) COLLATE NOCASE, v.id")
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        rows = conn.execute(f"""
            SELECT v.id FROM videos v
            JOIN series s ON s.id = v.series_id
            JOIN albums a ON a.id = s.album_id
            WHERE v.media_kind = 'audio'{priv}
            ORDER BY {order}
        """).fetchall()
        return [r['id'] for r in rows]

    def get_video_cards(self, ids: List[int], private_categories=None) -> list:
        """複数idのvideoをカード表示(VideoRow)用の形で返す(アルバム詳細と同じ列 +
        series/album情報)。ローカル保存一覧・続きを見る一覧をライブラリと同じカードで
        描画するために使う。存在しないidは結果から欠落する(入力順は保持)。"""
        if not ids:
            return []
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        ph = ','.join('?' * len(ids))
        rows = conn.execute(f"""
            SELECT v.id, v.eit_title, v.episode_number, v.episode_name,
                   v.duration_sec, v.file_size, v.created_at, v.updated_at,
                   v.thumbnail_path, v.eit_start_time, COALESCE(v.has_caption, 0) AS has_caption, (CASE WHEN v.captions3_json IS NOT NULL AND v.captions3_json NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_added_caption, COALESCE(v.added_comment_tracks, 0) AS added_comment_tracks, COALESCE(v.max_comment_count, v.comment_count) AS max_comment_count, 
                   v.comment_count, v.file_path, v.onid, v.sid, v.tsid, v.eid, v.eit_station_name,
                   v.drop_error, v.recording_start_time, v.eit_audio_info, v.setting,
                   v.sort_order, v.announce, v.allow_duplicate, v.has_secondary_audio,
                   v.media_kind, v.artist, v.video_codec,
                   v.series_id, s.name AS series_name, s.album_id AS album_id,
                   a.name AS album_name
            FROM videos v
            LEFT JOIN series s ON v.series_id = s.id
            LEFT JOIN albums a ON s.album_id = a.id
            WHERE v.id IN ({ph}){priv}
        """, tuple(ids)).fetchall()
        by_id = {r['id']: dict(r) for r in rows}
        # ローカル保存/続きを見るのカードもアルバム横断なのでカテゴリを付ける
        return self.attach_categories([by_id[i] for i in ids if i in by_id])

    def set_allow_duplicate(self, video_id: int, allow: bool) -> None:
        """重複録画の許可フラグを設定する(videoカードの「…」からのトグル)。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET allow_duplicate=?, updated_at=? WHERE id=?",
                     (1 if allow else 0, datetime.now().isoformat(), video_id))
        conn.commit()

    def get_video_filing(self, video_id: int) -> Optional[dict]:
        """確定値変更検出用に folder(album名)/title(series名)/episode_number/episode_name を返す。"""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT v.episode_number, v.episode_name, s.name AS title, a.name AS folder "
            "FROM videos v LEFT JOIN series s ON v.series_id=s.id "
            "LEFT JOIN albums a ON s.album_id=a.id WHERE v.id=?",
            (video_id,)).fetchone()
        return dict(row) if row else None

    def update_video(self, video_id: int, **fields):
        """videos の任意列を UPDATE する（確定値編集用）。"""
        if not fields:
            return
        # drop_error を書き換えたら、畳んだ件数の列も必ず追従させる
        if 'drop_error' in fields:
            fields['drop_count'], fields['scramble_count'] = \
                drop_scramble_counts(fields['drop_error'])
        conn = self._get_conn()
        # 字幕1/2 を書き換えたら has_caption も必ず追従させる。片方だけの更新もあるので
        # 指定されなかった側は既存行から読む
        if 'captions_json' in fields or 'captions2_json' in fields:
            cur = conn.execute("SELECT captions_json, captions2_json FROM videos WHERE id=?",
                               (video_id,)).fetchone()
            fields['has_caption'] = caption_flag(
                fields.get('captions_json', cur['captions_json'] if cur else None),
                fields.get('captions2_json', cur['captions2_json'] if cur else None))
        # コメントを書き換えたら追加トラック数と最大件数も追従させる
        if 'comments_json' in fields or 'comment_count' in fields:
            cur = conn.execute("SELECT comments_json, comment_count FROM videos WHERE id=?",
                               (video_id,)).fetchone()
            fields['added_comment_tracks'], fields['max_comment_count'] = comment_track_stats(
                fields.get('comments_json', cur['comments_json'] if cur else None),
                fields.get('comment_count', cur['comment_count'] if cur else 0))
        fields['updated_at'] = datetime.now().isoformat()
        set_clause = ', '.join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE videos SET {set_clause} WHERE id=?", list(fields.values()) + [video_id])
        conn.commit()

    def delete_video(self, video_id: int):
        """video を削除し、配下 video が0件になった series / album も掃除する。"""
        conn = self._get_conn()
        row = conn.execute("SELECT series_id FROM videos WHERE id=?", (video_id,)).fetchone()
        if not row:
            return
        series_id = row['series_id']
        conn.execute("DELETE FROM category_nodes WHERE node_type='video' AND node_id=?", (video_id,))
        conn.execute("DELETE FROM videos WHERE id=?", (video_id,))
        if series_id is not None and \
                conn.execute("SELECT COUNT(*) FROM videos WHERE series_id=?", (series_id,)).fetchone()[0] == 0:
            srow = conn.execute("SELECT album_id FROM series WHERE id=?", (series_id,)).fetchone()
            album_id = srow['album_id'] if srow else None
            conn.execute("DELETE FROM category_nodes WHERE node_type='series' AND node_id=?", (series_id,))
            conn.execute("DELETE FROM series WHERE id=?", (series_id,))
            if album_id is not None and \
                    conn.execute("SELECT COUNT(*) FROM series WHERE album_id=?", (album_id,)).fetchone()[0] == 0:
                conn.execute("DELETE FROM category_nodes WHERE node_type='album' AND node_id=?", (album_id,))
                conn.execute("DELETE FROM albums WHERE id=?", (album_id,))
        conn.commit()
