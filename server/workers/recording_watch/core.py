"""録画の見張りワーカー — 録画完了検知 → recordings テーブルに INSERT（state=pending）。

重い TS スキャン・text_parser・queued 判定は RecordingScanWorker（workers/recording_scan/）
が pending を拾って直列実行する。録画の見張り tick はここで完了し即座に返る。
"""

import data_paths  # server/ と server/data の場所
import logging
import os
from datetime import datetime

from workers.base import IntervalWorker
from .orphans import _OrphanRecordingsMixin
from .rules import _RuleRecordingsMixin


logger = logging.getLogger('workers.recording_watch')   # 分ける前と同じ名前で出す


class RecordingWatchWorker(_OrphanRecordingsMixin, _RuleRecordingsMixin, IntervalWorker):
    """
    interval 秒ごとに録画完了を検知し、recordings テーブルへ INSERT（state=pending）する。
    重いスキャン以降は RecordingScanWorker に委譲するため、この tick は軽量で即座に返る。

    手順0: orphan 検知
      EDCB 録画一覧にあるが DB 未登録の録画を state=pending で登録。

    手順1: 録画ファイル検出
      1. programs から state='pending' かつ expected_end_time < 現在時刻 を取得
      2. enum_rec_info() で全録画一覧取得
      3. matcher.find_all_rec_files() で該当ファイルを全件収集
      4. recordings テーブルに state='pending' で INSERT
      5. programs.state = 'recorded'
      （TSスキャン・text_parser・queued 判定は RecordingScanWorker が pending を拾って実行）

    手順3: 全録画の file_exist 再チェック
    """

    label = 'recording_watch'
    log_name = 'workers.recording_watch'   # クラスを core.py へ移す前と同じ名前で出す

    def __init__(self, config: dict, db, edcb, parser_store=None):
        super().__init__(config.get('phase_b_interval', 60))
        self.config = config
        self.db = db
        self.edcb = edcb
        self.parser_store = parser_store
        self.edcb_url = ((config.get('edcb_servers') or [{}])[0].get('url')) or config.get('edcb_url', '')
        self.started_at = datetime.now()

    def _tick(self):
        # best-effort WAL チェックポイント（rules.db-wal の肥大化抑制）。
        # リーダーがいる回は即 busy で終わり、失敗は wal_checkpoint 内部で握りつぶす。
        self.db.wal_checkpoint()

        # EDCB録画一覧を一度だけ取得（B-0/B-1 共用）
        rec_list = self.edcb.enum_rec_info()
        if isinstance(rec_list, dict):
            rec_list = [rec_list]

        # 手順0: orphan 検知（EDCB にあるが DB 未登録の録画）を INSERT
        self._detect_orphan_recordings(rec_list)

        # 手順1: 録画ファイル検出 → recordings に INSERT（state=pending）
        rules = self.db.list_pending_past_end()
        for rule in rules:
            self._process_rule(rule, rec_list)

        # 手順3: 全録画の file_exist 再チェック
        self._recheck_file_exist()

    # ------------------------------------------------------------------
    # 手順0: orphan 検知
    # ------------------------------------------------------------------


    # ------------------------------------------------------------------
    # 手順1
    # ------------------------------------------------------------------


    # ------------------------------------------------------------------
    # 手順3: file_exist 再チェック
    # ------------------------------------------------------------------

    def _recheck_file_exist(self):
        """全録画のファイル存在確認を毎 tick 更新する。ファイルなし確定済みはスキップ。
        手動登録（EDCB管理外）はファイル消失＝実体なしなのでエントリごと自動削除する。"""
        for recording in self.db.list_recordings():
            is_manual = recording.get('rec_id') is None and recording.get('program_id') is None
            if recording.get('file_exist') == 0 and not is_manual:
                continue
            ts_path = recording.get('app_ts_path') or recording.get('edcb_ts_path', '')
            if not ts_path:
                continue
            exists = int(os.path.exists(ts_path))
            # 外部ディスク取り外し中は file_exist を据え置き（消失=削除と誤認しない）
            if exists == 0 and self.db.disk_offline(ts_path):
                continue
            if exists == 0 and is_manual and recording.get('state') != 'scanning':
                for p in (recording.get('thumbnail_path'), recording.get('thumbnail_tile_path')):
                    try:
                        if p and os.path.exists(p):
                            os.remove(p)
                    except Exception:
                        pass
                try:
                    from media.frame_index.cache import delete_frame_table
                    delete_frame_table(recording['id'], data_paths.DATA_DIR)
                except Exception:
                    pass
                self.db.delete_recording(recording['id'])
                logger.info('録画の見張り: 手動登録 recording_id=%d のTS消失 → 自動削除 (%s)',
                            recording['id'], ts_path)
                continue
            if recording.get('file_exist') != exists:
                self.db.update_recording(recording['id'], file_exist=exists)
