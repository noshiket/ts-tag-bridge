"""キャプチャと動画の紐づけ（放送で動画を探す・まとめて付け直す）"""

from datetime import datetime


class _CaptureLinksMixin:
    """キャプチャと動画の紐づけ（放送で動画を探す・まとめて付け直す）"""

    def find_video_by_event(self, onid, tsid, sid, eid=None, tot=None):
        """番組(onid/tsid/sid/eid)に一致する動画を探す。無ければ None。

        eid 一致を優先し、無ければ sid が同じ動画のうち tot が放送時間内のものを返す。
        """
        if onid is None or sid is None:
            return None
        conn = self._get_conn()
        if eid is not None:
            row = conn.execute(
                "SELECT * FROM videos WHERE onid=? AND tsid=? AND sid=? AND eid=? "
                "ORDER BY id LIMIT 1", (onid, tsid, sid, eid)).fetchone()
            if row:
                return dict(row)
        if not tot:
            return None
        row = conn.execute(
            "SELECT * FROM videos WHERE onid=? AND sid=? AND eit_start_time IS NOT NULL "
            "AND eit_start_time <= ? AND (eit_end_time IS NULL OR eit_end_time >= ?) "
            "ORDER BY id LIMIT 1", (onid, sid, tot, tot)).fetchone()
        return dict(row) if row else None

    def find_captures_for_video(self, video: dict) -> list:
        """動画に対応する「まだどの動画にも紐づいていない」キャプチャを返す。"""
        onid, tsid, sid = video.get('onid'), video.get('tsid'), video.get('sid')
        eid = video.get('eid')
        if onid is None or sid is None:
            return []
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM captures WHERE video_id IS NULL AND onid=? AND tsid=? AND sid=? AND eid=?",
            (onid, tsid, sid, eid)).fetchall() if eid is not None else []
        if rows:
            return [dict(r) for r in rows]
        start, end = video.get('eit_start_time'), video.get('eit_end_time')
        if not start:
            return []
        rows = conn.execute(
            "SELECT * FROM captures WHERE video_id IS NULL AND onid=? AND sid=? "
            "AND tot IS NOT NULL AND tot >= ? AND (? IS NULL OR tot <= ?)",
            (onid, sid, start, end, end)).fetchall()
        return [dict(r) for r in rows]

    def link_captures_for_video(self, video_id: int) -> int:
        """動画登録時に、対応する未紐づけキャプチャをまとめてこの動画へ繋ぐ。"""
        video = self.get_video_row(video_id)
        if not video:
            return 0
        caps = self.find_captures_for_video(video)
        if not caps:
            return 0
        return self.relink_captures([c['id'] for c in caps], video_id)

    def relink_captures(self, capture_ids: list, video_id: int) -> int:
        """delete_video で video_id が NULL 化されたキャプチャを新しい video へ付け替える。
        動画の移動/再ファイル(delete_video → add_videos で id が変わる)で呼ぶ。
        呼ぶ側は delete_video の前に get_captures(old_id) で id を控えておくこと。"""
        if not capture_ids:
            return 0
        conn = self._get_conn()
        now = datetime.now().isoformat()
        cur = conn.executemany("UPDATE captures SET video_id=?, updated_at=? WHERE id=?",
                               [(video_id, now, cid) for cid in capture_ids])
        conn.commit()
        return cur.rowcount
