"""録画の見張り: ルールの無い録画を拾う"""

import os
from datetime import datetime, timedelta
from logic.storage import path_translator
from .common import _base_path_if_suffixed, _REC_STATUS_ERROR
import logging

# 元の workers.recording_watch と同じ名前でログに出す
logger = logging.getLogger('workers.recording_watch')


class _OrphanRecordingsMixin:
    """録画の見張り: ルールの無い録画を拾う"""

    def _detect_orphan_recordings(self, rec_list: list):
        """EDCB録画一覧のうち、DB未登録かつ pending プログラムに対応しないものを登録する。"""
        known = self.db.known_rec_ids()
        for rec in rec_list:
            edcb_rec_id = rec.get('id')
            if edcb_rec_id is None:
                continue

            onid = rec.get('onid')
            tsid = rec.get('tsid')
            sid  = rec.get('sid')
            eid  = rec.get('eid')

            # pending/matched プログラムが存在する場合は 手順1 に任せる
            if all(x is not None for x in (onid, tsid, sid, eid)):
                key = f'{onid}-{tsid}-{sid}-{eid}'
                prog = self.db.get_by_key(key)
                if prog and prog.get('state') in ('pending', 'matched', 'recorded'):
                    continue

            ts_path = rec.get('recFilePath', '')

            start_epg = rec.get('startTimeEpg') or ''
            dur = rec.get('durationSecond')
            if start_epg and dur is not None:
                try:
                    eit_end = (datetime.fromisoformat(start_epg) + timedelta(seconds=dur)).isoformat()
                except (ValueError, TypeError):
                    eit_end = None
            else:
                eit_end = None

            # エラーでファイルも無い録画結果は、EDCBが再試行のたびに別 rec_id で残すため
            # 同一イベントで1行だけに抑える(B-1側と同じ理由。中断は対象にしない)。
            if (not ts_path and rec.get('recStatus') == _REC_STATUS_ERROR
                    and all(x is not None for x in (onid, tsid, sid, eid))):
                same = self.db.find_recordings_by_event(onid, tsid, sid, eid, start_epg or None)
                if any(r.get('rec_status') == _REC_STATUS_ERROR
                       and not r.get('edcb_ts_path') for r in same):
                    continue

            # 新規孤立録画のみ追加（既知の場合はスキップ）
            if edcb_rec_id not in known:
                paths = path_translator.translate_paths(ts_path, self.config)
                self.db.add_recording(
                    None, edcb_rec_id,
                    onid=onid, tsid=tsid, sid=sid, eid=eid,
                    rec_status=rec.get('recStatus'),
                    rec_comment=rec.get('comment', ''),
                    server_url=self.edcb_url,
                    eit_start_time=start_epg or None,
                    eit_end_time=eit_end,
                    **paths,
                )
                logger.info('録画の見張り: orphan recording edcb_id=%d → registered for EIT scan', edcb_rec_id)

            # -(N) サフィックスがある場合、ベースファイルも確認して追加
            base_edcb = _base_path_if_suffixed(ts_path)
            if base_edcb and not self.db.has_recording_with_edcb_path(base_edcb):
                base_paths = path_translator.translate_paths(base_edcb, self.config)
                host_base = base_paths.get('host_ts_path', base_edcb)
                if os.path.exists(host_base):
                    parent_rec = self.db.get_recording_by_rec_id(edcb_rec_id) if edcb_rec_id else None
                    parent_program_id = parent_rec.get('program_id') if parent_rec else None
                    eit_start = parent_rec.get('eit_start_time') if parent_rec else None
                    eit_end   = parent_rec.get('eit_end_time')   if parent_rec else None
                    edcb_tag  = parent_rec.get('edcb_tag')       if parent_rec else None
                    self.db.add_recording(
                        parent_program_id, None,
                        onid=onid, tsid=tsid, sid=sid, eid=eid,
                        rec_status=rec.get('recStatus'),
                        rec_comment=f'base of {os.path.basename(ts_path)}',
                        eit_start_time=eit_start,
                        eit_end_time=eit_end,
                        edcb_tag=edcb_tag,
                        server_url=self.edcb_url,
                        **base_paths,
                    )
                    logger.info('録画の見張り: orphan base file added: %s', base_edcb)
