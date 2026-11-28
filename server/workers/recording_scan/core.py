"""録画の見張りスキャンワーカー — state=pending の録画を直列スキャンする専用ワーカー。

録画の見張り tick（録画検出＋recordings INSERT）から重い TS スキャンを分離した別スレッド。
単一スレッドのため自然に 1 本ずつ直列にスキャンされる。スキャンが数分かかっても
録画の見張り tick は別スレッドで動き続けるため、スキャン消化中も新着録画は recordings に
追加され続ける（B-0 が止まらない）。

処理: list_recordings_by_state('pending') を放送開始(eit_start_time)が新しい順に
  1. HDD負荷defer: 録画中本数 >= phase_b_defer_recordings なら今回はスキャンせず return
  2. add_recording.process() で TSスキャン・text_parser・segments（pending→scanning→waiting）
  3. B-1 由来（program_id あり）の録画のみ _queue_if_eligible で queued 判定
     orphan / 手動登録（program_id なし）は waiting 止まり（自動キュー登録しない）
"""

import logging
from datetime import datetime

from logic import add_recording as _ar
from workers.base import IntervalWorker
from .reparse import _ScanReparseMixin
from .queue import _ScanQueueMixin

logger = logging.getLogger('workers.recording_scan')   # 分ける前と同じ名前で出す


class RecordingScanWorker(_ScanReparseMixin, _ScanQueueMixin, IntervalWorker):
    """pending 録画を直列スキャンし、B-1 由来は queued 判定まで行うワーカー。"""

    label = 'recording_scan'
    log_name = 'workers.recording_scan'   # クラスを core.py へ移す前と同じ名前で出す

    def __init__(self, config: dict, db, edcb, parser_store=None):
        super().__init__(config.get('phase_b_scan_interval', 30))
        self.config = config
        self.db = db
        self.edcb = edcb
        self.parser_store = parser_store
        # 録画中がこの本数以上の間は重いスキャンを次tickへ先送り（HDD負荷でのDROP防止）
        self.defer_threshold = config.get('phase_b_defer_recordings', 2)
        # エンコード（Amatsukaze）実行中は重いスキャンを先送り（CPU競合でGUIが重くなるのを防ぐ）。
        # ただしエンコードキューが常時埋まる運用ではスキャンが恒久的に止まるため既定は無効。
        self.defer_during_encode = config.get('phase_b_defer_during_encode', False)
        self._post_sync_mark = 0.0     # 番組表の取り直し後の解析し直しを済ませた取得時刻
        self.started_at = datetime.now()

    def _on_start(self):
        # 起動時: 前回クラッシュで scanning のまま残った録画を pending に戻す
        n = self.db.reset_scanning_recordings()
        if n:
            logger.info('録画の走査: reset %d scanning→pending recordings on startup', n)

    def _safe_tick(self):
        t0 = datetime.now()
        try:
            super()._safe_tick()
        finally:
            # バックログ消化中は 1 tick が interval を大きく超え last_run が長時間更新
            # されないが、これは直列スキャン中であって異常ではない（録画の見張り tick は別
            # スレッドで動き続ける）。ハングと誤認しないよう明示する。
            elapsed = (datetime.now() - t0).total_seconds()
            if elapsed > self.interval * 2:
                logger.debug('録画の走査: tick took %.0fs (>%ds interval) — drained scan backlog '
                            'serially (not a hang; 録画の見張り tick runs independently)',
                            elapsed, self.interval)


    def _tick(self):
        try:
            self._reparse_after_sync()
        except Exception as e:
            logger.error('録画の走査 post-sync reparse failed: %s', e)
        try:
            self._drain_rate_limited()
        except Exception as e:
            logger.error('録画の走査 rate-limited drain failed: %s', e)
        # 1件スキャンするたびに pending を取り直し、その時点で放送開始が最新のものを次に処理する。
        # （前のスキャン中に新しい録画が追加されたら、次はそちらを優先＝最新優先を厳密に保つ）
        logged = False
        while not self._stop_event.is_set():
            # エンコード実行中はスキャンを先送り（次tickで再開）。CPU競合でGUIが重くなるのを防ぐ。
            if self.defer_during_encode:
                running = self.db.count_running_encodings()
                if running > 0:
                    logger.info('録画の走査: %d encoding(s) in progress → defer remaining scans', running)
                    return

            # 録画中が多いときはスキャンを先送り（次tickで再開）。INSERT は録画の見張りが継続。
            # defer_threshold <= 0 でこの先送りは無効（録画中も即スキャン）。
            if self.defer_threshold > 0:
                ongoing = self._ongoing_recording_count()
                if ongoing >= self.defer_threshold:
                    logger.info('録画の走査: %d recording(s) in progress (>=%d) → defer remaining scans',
                                ongoing, self.defer_threshold)
                    return

            pending = self.db.list_recordings_by_state('pending', newest_first=True)  # 放送開始が新しい順
            if not pending:
                return
            if not logged:
                logger.debug('録画の走査: %d pending recording(s) to scan', len(pending))
                logged = True

            recording = pending[0]  # 最新の1件のみ処理し、次はまた取り直す
            rec_db_id = recording['id']
            _ar.process(self.db, rec_db_id, self.config, self.parser_store)

            # B-1 由来（program_id あり）のみ自動キュー登録判定。
            # orphan / 手動登録（program_id なし）は waiting 止まり。
            if recording.get('program_id') is not None:
                self._queue_if_eligible(rec_db_id)
