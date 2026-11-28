"""録画の見張り: ルールごとに録画を探して登録する"""

import json
import os
from datetime import datetime, timedelta
from logic.recordings import matcher
from logic.storage import path_translator
from .common import _base_path_if_suffixed, _REC_STATUS_ERROR
import logging

# 元の workers.recording_watch と同じ名前でログに出す
logger = logging.getLogger('workers.recording_watch')


def _ids_from_reserve_key(reserve_key):
    """'onid-tsid-sid-eid' → (onid, tsid, sid, eid)。読めなければ全部 None。"""
    parts = reserve_key.split('-')
    try:
        return int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
    except (ValueError, IndexError):
        return None, None, None, None


def _confirmed_from_rule(rule) -> dict:
    """予約の解析結果と確定値を、録画の列の形にする。"""
    tp_result_raw = rule.get('text_parser_result') or {}
    if isinstance(tp_result_raw, dict):
        tp_json = json.dumps(tp_result_raw, ensure_ascii=False)
    else:
        tp_json = tp_result_raw or None
    parser_error = rule.get('parser_error') or []
    if isinstance(parser_error, list):
        parser_error_json = json.dumps(parser_error, ensure_ascii=False)
    else:
        parser_error_json = parser_error or '[]'

    # list 型カラム（_LIST_COLS）は _row_to_dict で Python list になっているため JSON 文字列化
    def _sjson(v):
        return json.dumps(v, ensure_ascii=False) if isinstance(v, list) else v

    auto_send_raw = rule.get('auto_send')
    return dict(
        title=rule.get('title'),
        folder=rule.get('folder'),
        auto_add_id=rule.get('auto_add_id'),
        episode_number=_sjson(rule.get('episode_number')),
        episode_name=_sjson(rule.get('episode_name')),
        category=_sjson(rule.get('category')),
        furigana=rule.get('furigana'),
        else_info=rule.get('else_info'),
        auto_send=('true' if auto_send_raw else 'false') if auto_send_raw is not None else None,
        app_output_path=_sjson(rule.get('app_output_path')),
        app_output_path_format=rule.get('app_output_path_format'),
        setting=rule.get('setting'),
        is_text_parser=rule.get('is_text_parser'),
        text_parser_result=tp_json,
        parser_error=parser_error_json,
    )


class _RuleRecordingsMixin:
    """録画の見張り: ルールごとに録画を探して登録する"""

    def _process_rule(self, rule: dict, rec_list: list):
        rule_id     = rule['id']
        reserve_key = rule.get('reserve_key', '')
        start_time  = rule.get('start_time', '')
        ids = _ids_from_reserve_key(reserve_key)

        self.db.update_rule(rule_id, state='matched')

        rec_files = matcher.find_all_rec_files(reserve_key, start_time, rec_list,
                                               end_time=rule.get('expected_end_time') or '')
        if not rec_files:
            self._mark_not_found(rule)
            return

        # 予約の同期の text_parser_result と confirmed values を recording に引き継ぐ
        confirmed = _confirmed_from_rule(rule)

        # 新規録画ファイルのみ recordings に INSERT → add_recording → キュー登録
        existing = self.db.get_recordings(rule_id)
        existing_paths = {r['edcb_ts_path'] for r in existing}
        existing_rec_ids = {r['rec_id'] for r in existing if r.get('rec_id') is not None}
        # エラー(recStatus=2)でファイルも無い行が既にあるか。EDCBは録画に失敗すると
        # (「チューナーのオープンに失敗しました」等)再試行のたびに別 rec_id の録画結果を
        # 残すため、rec_id だけで重複判定すると同じ番組のエラー行が何十行もできる
        # (実際に1番組61行になっていた)。エラー行はエンコードできず non_file になるだけ
        # なので1番組1行に抑える。
        # 中断(recStatus=3。録画中のシャットダウン等)は同じ番組で複数行になるのが正常な
        # ため対象にしない。
        has_error_fileless = any(r.get('rec_status') == _REC_STATUS_ERROR
                                 and not r.get('edcb_ts_path') for r in existing)
        new_rec_ids: list[int] = []

        for rec in rec_files:
            ts = rec['ts_path']
            edcb_rec_id = rec['rec_id']
            # 重複判定はこのルール(program_id)配下だけでなく recordings 全体で行う。
            # EPG 更新等で同じ番組の programs 行が作り直されると program_id が変わり、
            # ルール内だけ見ていると同じ TS ファイルが別 program_id の行として二重登録される
            # （実際に同一 TS で recordings が2行できていた）。
            if ts:
                already = ts in existing_paths or self.db.has_recording_with_edcb_path(ts)
            else:
                is_error = rec.get('rec_status') == _REC_STATUS_ERROR
                already = ((has_error_fileless and is_error)
                           or edcb_rec_id in existing_rec_ids
                           or (edcb_rec_id is not None
                               and self.db.get_recording_by_rec_id(edcb_rec_id) is not None))
            if not already:
                paths = path_translator.translate_paths(ts, self.config) if ts else {}
                new_id = self._add_recording_row(rule, rec, ids, confirmed,
                                                 rec.get('rec_comment', ''), paths)
                if ts:
                    existing_paths.add(ts)
                else:
                    existing_rec_ids.add(edcb_rec_id)
                    if is_error:
                        has_error_fileless = True
                new_rec_ids.append(new_id)

            # -(N) サフィックスがある場合、ベースファイルを確認して追加
            base_edcb = _base_path_if_suffixed(ts)
            if base_edcb and base_edcb not in existing_paths:
                base_paths = path_translator.translate_paths(base_edcb, self.config)
                host_base = base_paths.get('host_ts_path', base_edcb)
                if os.path.exists(host_base):
                    base_id = self._add_recording_row(rule, rec, ids, confirmed,
                                                      f'base of {os.path.basename(ts)}', base_paths)
                    existing_paths.add(base_edcb)
                    new_rec_ids.append(base_id)
                    logger.info('録画の見張り: rule %d → base file added: %s', rule_id, base_edcb)

        # programs.state = recorded（INSERT 後に設定）
        # スキャン・queued 判定は RecordingScanWorker が pending を拾って実行する。
        self.db.update_rule(rule_id, state='recorded')
        ids_str = ' '.join(f'recording_id={i}' for i in new_rec_ids)
        logger.info('録画の見張り: rule %d → recorded (%d file(s))%s', rule_id, len(rec_files),
                    (' ' + ids_str) if ids_str else '')

    def _mark_not_found(self, rule):
        """録画ファイルがまだ無い予約を pending に戻す。終了から24時間たっても無ければ failed。"""
        rule_id = rule['id']
        now = datetime.now()
        expected_end = rule.get('expected_end_time')
        if expected_end:
            # expected_end_timeはEDCB由来で+09:00付きタイムゾーンを持つことがあり、naiveな
            # now/server_thresholdとの比較でTypeErrorになり録画の見張り tick全体が異常終了して
            # 同一tick内の以降のルールが処理されなくなっていた(録画のTS解析が進まなく見える
            # 不具合の原因)。tzinfoを落として比較する。
            deadline = datetime.fromisoformat(expected_end).replace(tzinfo=None) + timedelta(hours=24)
            server_threshold = self.started_at + timedelta(hours=24)
            if now > deadline and now > server_threshold:
                self.db.update_rule(rule_id, state='failed')
                logger.warning('録画の見張り: rule %d → failed (no recording 24h after end, server up 24h)', rule_id)
                return
        self.db.update_rule(rule_id, state='pending')
        logger.debug('録画の見張り: rule %d TS not found yet', rule_id)

    def _add_recording_row(self, rule, rec, ids, confirmed, rec_comment, paths):
        """録画1件を recordings に INSERT する（番組情報は予約から、時刻と状態は録画結果から）。"""
        onid, tsid, sid, eid = ids
        return self.db.add_recording(
            rule['id'], rec['rec_id'],
            onid=onid, tsid=tsid, sid=sid, eid=eid,
            rec_status=rec.get('rec_status'),
            rec_comment=rec_comment,
            eit_start_time=rec.get('eit_start_time'),
            eit_end_time=rec.get('eit_end_time'),
            eit_title=rule.get('original_title'),
            eit_description=rule.get('original_description'),
            eit_extended_info=rule.get('original_extended_info'),
            eit_station_name=rule.get('station_name'),
            eit_genre=rule.get('genre'),
            eit_video_info=rule.get('video_info'),
            eit_audio_info=rule.get('audio_info'),
            edcb_tag=rule.get('edcb_tag', ''),
            server_url=self.edcb_url,
            **confirmed,
            **paths,
        )
