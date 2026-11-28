"""tag.json からの登録（add_videos と、シリーズ・アルバム・並び順）"""

import os
import json
from datetime import datetime
from typing import Optional, Set
from logic.storage.mount_point import get_mount_point
from .common import logger
from .ingest_rows import _IngestRowsMixin


class _IngestMixin(_IngestRowsMixin):
    """VideoDB の一部（tag.json からの登録（add_videos と、シリーズ・アルバム・並び順））。"""

    # ------------------------------------------------------------------
    # 投入: tag.json → video.db
    # ------------------------------------------------------------------
    def add_videos(self, tag, replace: bool = False, on_replace=None) -> Optional[int]:
        """tag.json（dict またはファイルパス）を読み取り video.db へ登録する。

        戻り値: 登録した video_id。
        file_path 重複時は、replace=False なら既存 id をそのまま返す（再登録しない）。
        replace=True なら既存行を削除してから新規登録し直す（新 id・最新の tag.json 内容）。
        on_replace: replace で既存を差し替えて id が変わった時に on_replace(old_id, new_id) を呼ぶ。
                    視聴履歴リンクの張り替え等に使う（best-effort。VideoDB は他DBを直接参照しない）。
        """
        if isinstance(tag, str):
            with open(tag, encoding='utf-8') as f:
                tag = json.load(f)

        file_path = tag.get('app_output_path')
        if not file_path:
            raise ValueError("tag.json に app_output_path がありません")

        conn = self._get_conn()
        existing = conn.execute(
            "SELECT id FROM videos WHERE file_path = ?", (file_path,)
        ).fetchone()
        old_capture_ids = []
        old_id = None
        old_sort = None  # (series_id, sort_order): 同一series内での差し替えなら表示位置を引き継ぐ
        if existing:
            if not replace:
                return existing[0]
            old_id = existing[0]
            # 同じ file_path の既存行を削除してから登録し直す（最新の tag.json を反映）。
            # captures.video_id は FK(ON DELETE SET NULL)のため delete で NULL 化される。
            # 付け替え対象の capture id を先に控えておき、再登録後に新 video へ繋ぎ直す。
            old_capture_ids = [r[0] for r in conn.execute(
                "SELECT id FROM captures WHERE video_id=?", (existing[0],)).fetchall()]
            row = conn.execute("SELECT series_id, sort_order FROM videos WHERE id=?",
                               (existing[0],)).fetchone()
            if row:
                old_sort = (row['series_id'], row['sort_order'])
            self.delete_video(existing[0])

        now = datetime.now().isoformat()
        try:
            device = self._resolve_recording_device(file_path, tag.get('recording_device'))

            cats = tag.get('category') or []
            if isinstance(cats, str):
                cats = [cats]
            c_set: Set[int] = set()
            for name in cats:
                if name:
                    c_set.add(self._upsert_category(conn, name, now))

            folder = tag.get('folder')
            album_id = self._upsert_album(conn, folder, now) if folder else None

            title = tag.get('title')
            series_id = (self._upsert_series(conn, album_id, title, tag.get('furigana'), now)
                         if title else None)

            video_id = self._insert_video(conn, tag, file_path, series_id, device, now)

            # 副音声の有無を登録時に確定させる（ffprobe が要るので一覧では測れない）。
            # 判定不能なら NULL のままにして、再生時の metadata 取得で埋め直す。
            has_sec = self._detect_secondary_audio(file_path, tag)
            if has_sec is not None:
                conn.execute("UPDATE videos SET has_secondary_audio=? WHERE id=?",
                             (has_sec, video_id))

            # 表示位置(設定順): 同一seriesへの差し替えは元の位置を引き継ぎ、
            # 新規はepisode_number順(なければ放送日順)の位置へ挿入する
            if series_id is not None:
                if old_sort is not None and old_sort[0] == series_id:
                    conn.execute("UPDATE videos SET sort_order=? WHERE id=?",
                                 (old_sort[1], video_id))
                else:
                    self._assign_video_sort_order(conn, series_id, video_id, tag, now)

            self._reconcile_categories(conn, video_id, series_id, album_id, c_set)

            # replace で旧 video を消した際に NULL 化された captures を新 video へ付け替える。
            if old_capture_ids:
                conn.executemany("UPDATE captures SET video_id=?, updated_at=? WHERE id=?",
                                 [(video_id, now, cid) for cid in old_capture_ids])

            conn.commit()
            # 同じ番組のキャプチャが先に取り込まれていれば繋ぐ（別サーバーから
            # 画像→動画の順で持ち込んだ場合など。付け替え済みの分は対象外）
            try:
                n = self.link_captures_for_video(video_id)
                if n:
                    logger.info('add_video: video_id=%d に既存キャプチャ %d件を紐づけました', video_id, n)
            except Exception as e:
                logger.warning('add_video: キャプチャの照合に失敗(無視): %s', e)
        except Exception:
            conn.rollback()
            raise
        # 差し替えで id が変わった場合は通知（視聴履歴リンク張り替え等。best-effort）
        if on_replace is not None and old_id is not None and old_id != video_id:
            try:
                on_replace(old_id, video_id)
            except Exception:
                pass
        try:
            from logic.addons import addon_events
            addon_events.emit('video.added', {'video_id': video_id, 'replaced': old_id,
                                              'file_path': file_path,
                                              'title': tag.get('eit_title'),
                                              'station_name': tag.get('eit_station_name')})
        except Exception:
            pass
        return video_id

    @staticmethod
    def _detect_secondary_audio(file_path: str, tag: dict) -> Optional[int]:
        """副音声の有無(1/0)。判定できなければ None（未判定のまま残す）。"""
        try:
            from media.probe.ffprobe import detect_secondary_audio
            return detect_secondary_audio(file_path, tag.get('eit_audio_info') or '')
        except Exception:
            return None

    def set_video_codec(self, video_id: int, codec: Optional[str]) -> None:
        """映像コーデックを記録する（未判定行の遅延 backfill 用）。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET video_codec=? WHERE id=?", (codec, video_id))
        conn.commit()

    def set_secondary_audio(self, video_id: int, value: Optional[int]) -> None:
        """副音声の有無を記録する（未判定行の遅延 backfill 用）。"""
        conn = self._get_conn()
        conn.execute("UPDATE videos SET has_secondary_audio=? WHERE id=?", (value, video_id))
        conn.commit()

    def _resolve_recording_device(self, file_path: str, fallback: Optional[str]) -> Optional[str]:
        try:
            return get_mount_point(os.path.dirname(os.path.realpath(file_path)))
        except Exception:
            return fallback


