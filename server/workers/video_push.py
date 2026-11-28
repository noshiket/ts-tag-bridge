"""VideoPushWorker — encode_dir='master' の video を library_peer へ自動転送するワーカー。

従来はクライアント(ブラウザ)が relocate API を1本ずつ呼んで転送しており、
ブラウザを閉じる・キューの状態(メモリ)が消えると移動予約が宙に浮いていた。
このワーカーは videos.encode_dir='master'（tag.json と同期した永続マーク）を
interval ごとに拾い、サーバー間で直接転送する。失敗しても次周期で自動リトライ。

初回tickでは既存の移動予約を取りこぼさないよう、DB列が未同期(NULL)の video の
tag.json を一度だけ読んで encode_dir を videos へバックフィルする
（encode_dir 列追加以前に予約された分の救済）。
"""

import json
import logging
from datetime import datetime
from workers.base import IntervalWorker

logger = logging.getLogger(__name__)


class VideoPushWorker(IntervalWorker):
    label = 'VideoPush'
    run_first = False   # 最初の間隔を待ってから

    def __init__(self, config: dict, video_db, captures_dir: str):
        super().__init__(config.get('video_push_interval', 60))
        self.config = config
        self.db = video_db
        self.captures_dir = captures_dir
        self._backfilled = False
        self.started_at = datetime.now()

    def _backfill_encode_dir(self):
        """encode_dir 列が未同期(NULL)の video の tag.json を一度だけ読んで同期する。"""
        conn = self.db._get_conn()
        rows = conn.execute(
            "SELECT id, file_path FROM videos WHERE encode_dir IS NULL").fetchall()
        synced = 0
        for r in rows:
            tag_path = (r['file_path'] or '') + '.tag.json'
            try:
                with open(tag_path, encoding='utf-8') as f:
                    tag = json.load(f)
            except Exception:
                continue
            ed = tag.get('encode_dir')
            if isinstance(ed, list):
                idx = tag.get('episode_idx')
                idx = idx if isinstance(idx, int) and 0 <= idx < len(ed) else 0
                ed = ed[idx] if ed else None
            # encode_dirなしのtagは''で「同期済み」を記録し、次回起動時の再読込を避ける
            self.db.set_video_encode_dir(r['id'], ed or '')
            synced += 1
        if synced:
            logger.info('VideoPush: encode_dir を %d 件バックフィルしました', synced)

    def _tick(self):
        # 初回だけ encode_dir を同期する（失敗したら次の回にもう一度）
        if not self._backfilled:
            self._backfill_encode_dir()
            self._backfilled = True
        from logic.federation.video_push import push_video_to_master, try_begin, end
        pending = self.db.list_pending_master_push()
        for vid in pending:
            if self._stop_event.is_set():
                return
            if not try_begin(vid):
                continue  # relocate API が転送中
            try:
                res = push_video_to_master(self.db, self.config, vid, self.captures_dir)
            finally:
                end(vid)
            if not res.get('relocated'):
                # 失敗は次周期でリトライ（元ファイル不在(409)等もマークが残る限り拾い続ける）
                logger.warning('VideoPush: video_id=%d 転送失敗: %s', vid, res.get('error'))
