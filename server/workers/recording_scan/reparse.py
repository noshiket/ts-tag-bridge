"""録画の走査: 規制中で待たせた録画の解析し直し"""

from logic import add_recording as _ar
from text_parser.shoboi_api import background
from .common import _RATE_LIMITED_DRAIN_PER_TICK
import logging

# 元の workers.recording_scan と同じ名前でログに出す
logger = logging.getLogger('workers.recording_scan')


class _ScanReparseMixin:
    """録画の走査: 規制中で待たせた録画の解析し直し"""

    @background()
    def _drain_rate_limited(self) -> int:
        """規制中に text_parser を飛ばした録画を数件だけ解析し直す。

        規制中も試す（手元の番組表・作品情報で済めば問い合わせない）。問い合わせが要って
        また後回しになったものは、次に番組表を取り直すまで試さない。規制が明けている間は
        番組表の取り直しを先にする（取り直せば問い合わせずに解析できる分が多い）。
        """
        from text_parser.shoboi_api import has_rate_limited_error, rate_limit_remaining
        from text_parser import shoboi_store
        if rate_limit_remaining() <= 0 and shoboi_store.sync_pending():
            return 0
        mark = shoboi_store.synced_at()
        tried = self.__dict__.setdefault('_limited_tried', {})
        done = 0
        for rec in self.db.list_recordings_by_state('waiting', newest_first=True):
            if done >= _RATE_LIMITED_DRAIN_PER_TICK:
                break
            if not has_rate_limited_error(rec.get('parser_error') or ''):
                continue
            if rate_limit_remaining() > 0 and tried.get(rec['id']) == mark:
                continue
            tried[rec['id']] = mark
            done += 1
            if (_ar.retry_rate_limited(self.db, rec['id'], self.config, self.parser_store)
                    and rec.get('program_id') is not None):
                self._queue_if_eligible(rec['id'])
        return done

    @background()
    def _reparse_after_sync(self) -> int:
        """番組表を取り直した後、番組情報が取れずにエラーが残っている録画のうち、番組表に
        番組が載ったものを解析し直す。解析し直した件数を返す。"""
        from text_parser import shoboi_store
        mark = shoboi_store.synced_at()
        if not mark or mark == self._post_sync_mark:
            return 0
        self._post_sync_mark = mark
        n = 0
        for rec in self.db.list_recordings_by_state('waiting', newest_first=True):
            if self._stop_event.is_set():
                break
            if not shoboi_store.waits_for_program_info(rec.get('parser_error')):
                continue
            if not shoboi_store.has_program(rec.get('sid'), rec.get('eit_start_time')):
                continue
            n += 1
            if (_ar.reparse_from_ts(self.db, rec['id'], self.config, self.parser_store)
                    and rec.get('program_id') is not None):
                self._queue_if_eligible(rec['id'])
        logger.info('録画の走査: 番組表の取り直し後、番組が載った録画を %d件 解析し直しました', n)
        return n
