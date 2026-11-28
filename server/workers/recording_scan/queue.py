"""録画の走査: 録画中の数とエンコードのキューに載せるか"""

from datetime import datetime, timedelta
from logic.encoding import auto_encode as _auto_encode
from logic.recordings import episode_check
from .common import _REC_STATUS_NO_PROGRAM_INFO
import logging

# 元の workers.recording_scan と同じ名前でログに出す
logger = logging.getLogger('workers.recording_scan')


class _ScanQueueMixin:
    """録画の走査: 録画中の数とエンコードのキューに載せるか"""

    def _ongoing_recording_count(self) -> int:
        """現在録画中の予約本数。enum_reserve_info の時間窓（startTime〜startTime+durationSecond）で
        判定し、recEnabled=false の無効予約は除外する。EDCB に録画中フラグの直接APIがないための近似。"""
        try:
            reserves = self.edcb.enum_reserve_info()
        except Exception as e:
            logger.warning('録画の走査: enum_reserve_info failed, assume 0 ongoing: %s', e)
            return 0
        now = datetime.now()
        count = 0
        for r in reserves:
            if not (r.get('recSetting') or {}).get('recEnabled', True):
                continue
            start_raw = r.get('startTime')
            dur = r.get('durationSecond')
            if not start_raw or dur is None:
                continue
            try:
                # EDCBのREST実装によりstartTimeがtimezone付き(+09:00)で返る場合があり、
                # naiveなnowとの比較でTypeErrorになり本メソッド全体が握りつぶされ、常に
                # ongoing=0(=defer無効)になっていた不具合を修正。tzinfoを落として比較する
                # （このワーカー内は常にJST naiveとして扱う前提のため）。
                start = datetime.fromisoformat(start_raw).replace(tzinfo=None)
            except (ValueError, TypeError):
                continue
            if start <= now <= start + timedelta(seconds=dur):
                count += 1
        return count

    def _queue_if_eligible(self, rec_db_id: int) -> None:
        """add_recording 完了後、キュー登録条件を確認して queued または waiting 継続。"""
        recording = self.db.get_recording(rec_db_id)
        if not recording or recording.get('state') != 'waiting':
            return

        # auto_encode ルール評価 → 確定値マッチで auto_send=true(=優先度3)
        if _auto_encode.apply_to_recording(self.db, recording):
            logger.info('録画の走査: recording_id=%d → auto_send=true (auto_encode match)', rec_db_id)

        # auto_send 無効 / multi_episode / parser_error あり → waiting のまま。
        # auto_sendは true=優先度3、1〜5=その優先度、0/false/null/その他=無効
        priority = _auto_encode.auto_send_priority(recording.get('auto_send'))
        if priority == 0:
            logger.info('録画の走査: recording_id=%d → waiting (auto_send無効)', rec_db_id)
            return
        if episode_check.is_multi_episode(recording.get('episode_number')):
            logger.info('録画の走査: recording_id=%d → waiting (multi_episode)', rec_db_id)
            return
        if recording.get('parser_error'):
            logger.info('録画の走査: recording_id=%d → waiting (parser_error)', rec_db_id)
            return
        if recording.get('rec_status') == _REC_STATUS_NO_PROGRAM_INFO:
            logger.info('録画の走査: recording_id=%d → waiting (rec_status=%d %s)',
                        rec_db_id, _REC_STATUS_NO_PROGRAM_INFO,
                        recording.get('rec_comment') or '番組情報を確認できませんでした')
            return
        # folder/title の確定値が未設定、または分割結果が全てSKIP → waiting のまま。
        # 手動キュー投入(queue/requeue)と同じ判定を使う。
        from logic.encode_pipeline.runner.create import check_encodable
        reason = check_encodable(recording)
        if reason:
            # 出力先が無いのは、待っていても埋まらない（確定値を直す必要がある）のでエラーで見せる
            from logic.encode_pipeline.output_check import output_missing_reason
            if output_missing_reason(recording) == reason:
                self.db.update_recording(rec_db_id, state='error', error_message=reason)
                logger.warning('録画の走査: recording_id=%d → error (%s)', rec_db_id, reason)
                return
            logger.info('録画の走査: recording_id=%d → waiting (%s)', rec_db_id, reason)
            return

        self.db.update_recording(rec_db_id, state='queued')
        logger.info('録画の走査: recording_id=%d → queued', rec_db_id)

        # make_DB(encodings行の作成)まで実行する。手動キュー(queue_recording)と同じ扱い。
        # これが無いと state=queued のまま encodings が作られずエンコードの実行が何も
        # ディスパッチしない(自動エンコードが止まって見える)。失敗は create_encodings
        # 内で recordings.state='error' に回収される。
        try:
            from logic.encode_pipeline.runner.create import create_encodings
            create_encodings(self.db, rec_db_id, self.config)
            logger.info('録画の走査: recording_id=%d → make_DB done (encodings created)', rec_db_id)
            # auto_sendの値をそのままエンコード優先度へ(既定3以外のときのみ上書き)
            if priority != 3:
                for enc in self.db.get_encodings(rec_db_id):
                    if enc.get('state') not in ('encode_end', 'encode_error'):
                        self.db.update_encoding(enc['id'], priority=priority)
                logger.info('録画の走査: recording_id=%d → encodings priority=%d', rec_db_id, priority)
        except Exception as e:
            logger.error('録画の走査: create_encodings rec=%d failed: %s', rec_db_id, e)
