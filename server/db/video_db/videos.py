"""動画の行・パス・移動・サムネ・シリーズの中身"""

from datetime import datetime
from typing import Optional, List
from .common import (  # noqa: F401
    UNCATEGORIZED_ALBUM_ID,
)
from .video_order import _VideoOrderMixin
from .video_files import _VideoFilesMixin


class _VideosMixin(_VideoOrderMixin, _VideoFilesMixin):
    """VideoDB の一部（動画の行・パス・移動・サムネ・シリーズの中身）。"""


    def list_videos(self, page: int = 0, per_page: int = 30, sort: str = 'broadcast',
                    sort_dir: str = 'desc', date_from: str = None, date_to: str = None,
                    text: str = None, dir_root: str = None, perm_conds=None,
                    private_categories=None, media_kind=None) -> dict:
        """全 video をフラットに(album 横断で)ページング返却する。ライブラリの「ビデオ」表示用。

        放送日 = COALESCE(eit_start_time, recording_start_time, created_at)。
        date_from/date_to(YYYY-MM-DD)で放送日を範囲絞込。text はタイトル/話数名の部分一致。
        dir_root は保存先ディレクトリ(encode_dir_list の1つ)で、file_path の前方一致で絞る。
        sort: broadcast(放送日)/added(追加日)/name(タイトル)/velocity(コメント勢い)。
        """
        conn = self._get_conn()
        bdate = "COALESCE(v.eit_start_time, v.recording_start_time, v.created_at)"
        clauses, params = [], []
        if date_from:
            clauses.append(f"{bdate} >= ?")
            params.append(str(date_from))
        if date_to:
            # date_to は当日終端まで含める(YYYY-MM-DD なら +1日未満)
            clauses.append(f"{bdate} < ?")
            params.append(str(date_to) + 'T99')
        if text:
            clauses.append("(v.eit_title LIKE ? OR v.episode_name LIKE ?)")
            params += [f'%{text}%', f'%{text}%']
        if dir_root:
            clauses.append("v.file_path LIKE ?")
            params.append(str(dir_root).rstrip('/') + '/%')
        # 閲覧権限(局許可 / NGカテゴリ)。ページングが崩れないようSQL側で絞る
        if perm_conds:
            clauses += perm_conds[0]
            params += perm_conds[1]
        mk = self.media_kind_sql('v', media_kind)
        if mk:
            clauses.append(mk[len(' AND '):])
        where = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''
        # 非公開カテゴリを除く。WHERE が無い場合もあるので条件側で組み立てる
        pf = self.private_filter_sql('v', private_categories)
        if pf:
            where = (where + pf) if where else ('WHERE 1=1' + pf)

        order = {
            'broadcast': bdate,
            'added':     'v.created_at',
            'name':      'v.eit_title',
            'velocity':  '(CASE WHEN v.duration_sec > 0 THEN v.comment_count * 60.0 / v.duration_sec ELSE 0 END)',
        }.get(sort, bdate)
        direction = 'ASC' if str(sort_dir).lower() == 'asc' else 'DESC'

        total = conn.execute(f"SELECT COUNT(*) FROM videos v {where}", params).fetchone()[0]
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
            {where}
            ORDER BY {order} {direction}, v.id DESC
            LIMIT ? OFFSET ?
        """, params + [per_page, page * per_page]).fetchall()
        # album 横断の一覧なので、アルバム詳細と同じくカテゴリを付けて返す
        items = self.attach_categories([dict(r) for r in rows])
        return {'items': items, 'total': total, 'page': page, 'per_page': per_page}


    def set_video_encode_dir(self, video_id: int, encode_dir) -> None:
        """videos.encode_dir を更新する（確定値編集での tag.json 変更と同期させる用）。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET encode_dir=?, updated_at=? WHERE id=?",
                     (encode_dir, datetime.now().isoformat(), video_id))
        conn.commit()

    def list_pending_master_push(self) -> List[int]:
        """encode_dir='master'（library_peerへの移動予約）の video id を古い順で返す。"""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id FROM videos WHERE encode_dir='master' ORDER BY id").fetchall()
        return [r['id'] for r in rows]

    def touch_video(self, video_id: int) -> None:
        """video の updated_at を現在時刻に更新する（サムネ差し替え時のキャッシュ無効化用）。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET updated_at=? WHERE id=?",
                     (datetime.now().isoformat(), video_id))
        conn.commit()


    def get_album_video_ids(self, album_id: int) -> list:
        """album 配下の全 video id を返す（フォルダ一括変更の対象を集めるのに使う）。"""
        conn = self._get_conn()
        if album_id == UNCATEGORIZED_ALBUM_ID:
            rows = conn.execute(
                "SELECT v.id FROM videos v JOIN series s ON v.series_id = s.id "
                "WHERE s.album_id IS NULL ORDER BY v.id").fetchall()
        else:
            rows = conn.execute(
                "SELECT v.id FROM videos v JOIN series s ON v.series_id = s.id "
                "WHERE s.album_id = ? ORDER BY v.id", (album_id,)).fetchall()
        return [r[0] for r in rows]

    def find_video_id_by_path(self, file_path: str) -> Optional[int]:
        """file_path に一致する video の id を返す（無ければ None）。
        再配置の移動先が既に別 video に使われていないかの確認に使う。"""
        if not file_path:
            return None
        conn = self._get_conn()
        row = conn.execute("SELECT id FROM videos WHERE file_path=?", (file_path,)).fetchone()
        return row[0] if row else None

    def get_video_row(self, video_id: int) -> Optional[dict]:
        """video の全列を返す。"""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
        return dict(row) if row else None

    def find_video_by_music_key(self, music_key: str) -> Optional[int]:
        """曲の同一性キーから video_id を引く。無ければ None。

        置き場所が違っても（別フォルダへリッピングし直した等）同じ曲だと分かるようにする。
        """
        if not music_key:
            return None
        row = self._get_conn().execute(
            "SELECT id FROM videos WHERE music_key=?", (music_key,)).fetchone()
        return row[0] if row else None

    def find_video_by_path(self, file_path: str) -> Optional[int]:
        """file_path から video_id を引く。無ければ None。

        取り込み前に「もう登録済みか」を確かめる用（add_videos は既存なら既存 id を
        返すが、そこへ辿り着く前の変換を省きたい）。
        """
        if not file_path:
            return None
        row = self._get_conn().execute(
            "SELECT id FROM videos WHERE file_path=?", (file_path,)).fetchone()
        return row[0] if row else None

    def get_album_row(self, album_id: int) -> Optional[dict]:
        """album の全列を返す。"""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM albums WHERE id=?", (album_id,)).fetchone()
        return dict(row) if row else None

    def get_series_row(self, series_id: int) -> Optional[dict]:
        """series の全列を返す。"""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM series WHERE id=?", (series_id,)).fetchone()
        return dict(row) if row else None

    def get_series_videos(self, series_id: int, private_categories=None) -> Optional[dict]:
        """series単体の情報＋配下video一覧(設定順=sort_order昇順、同値はcreated_at昇順)を返す。
        get_album_detail()のseries配下videoと同じ列構成の軽量版
        （プレイヤー右パネルの「シリーズ」タブ用）。"""
        conn = self._get_conn()
        priv = self.private_filter_sql('v', private_categories)
        series = conn.execute("SELECT * FROM series WHERE id=?", (series_id,)).fetchone()
        if not series:
            return None
        videos = conn.execute(f"""
            SELECT id, eit_title, episode_number, episode_name,
                   duration_sec, file_size, created_at, updated_at,
                   thumbnail_path, eit_start_time, COALESCE(has_caption, 0) AS has_caption, (CASE WHEN captions3_json IS NOT NULL AND captions3_json NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_added_caption, COALESCE(added_comment_tracks, 0) AS added_comment_tracks, COALESCE(max_comment_count, comment_count) AS max_comment_count, 
                   comment_count, file_path, onid, sid, eit_station_name, drop_error,
                   recording_start_time, eit_audio_info, setting, sort_order, announce,
                   allow_duplicate, has_secondary_audio, media_kind, artist, video_codec
            FROM videos v WHERE series_id=?{priv} ORDER BY sort_order ASC, created_at ASC
        """, (series_id,)).fetchall()
        result = dict(series)
        result['videos'] = [dict(v) for v in videos]
        return result


