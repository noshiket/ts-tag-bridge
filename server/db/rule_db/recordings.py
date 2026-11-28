"""録画（recordings）"""

import json
from datetime import datetime
from typing import Optional, Set
from .common import _LIST_COLS, _dump_list, _emit
from .recording_queries import _RecordingQueriesMixin


class _RecordingsMixin(_RecordingQueriesMixin):
    """ProgramDB の一部（録画（recordings））。"""

    # ------------------------------------------------------------------
    # recordings
    # ------------------------------------------------------------------

    def known_rec_ids(self) -> Set[int]:
        """recordings テーブルおよび ignored_rec_ids に登録済みの EDCB rec_id セットを返す。"""
        rows = self._get_conn().execute(
            "SELECT rec_id FROM recordings WHERE rec_id IS NOT NULL"
            " UNION SELECT rec_id FROM ignored_rec_ids"
        ).fetchall()
        return {row[0] for row in rows}

    def has_recording_with_edcb_path(self, edcb_ts_path: str) -> bool:
        """指定の edcb_ts_path が recordings テーブルに存在するか確認する。"""
        row = self._get_conn().execute(
            "SELECT 1 FROM recordings WHERE edcb_ts_path = ? LIMIT 1", (edcb_ts_path,)
        ).fetchone()
        return row is not None

    def add_recording(self, program_id: Optional[int], rec_id: Optional[int],
                      onid: int = None, tsid: int = None,
                      sid: int = None, eid: int = None,
                      edcb_ts_path: str = None, host_ts_path: str = None,
                      app_ts_path: str = None, amatsukaze_ts_path: str = None,
                      konomitv_ts_path: str = None,
                      rec_status: int = None, rec_comment: str = None,
                      eit_start_time: str = None, eit_end_time: str = None,
                      eit_title: str = None, eit_description: str = None,
                      eit_extended_info: str = None, eit_station_name: str = None,
                      eit_genre: str = None, eit_video_info: str = None,
                      eit_audio_info: str = None,
                      file_exist: int = None, file_size: int = None,
                      duration_sec: float = None, drop_error: str = None,
                      recording_start_time: str = None, recording_end_time: str = None,
                      title: str = None, folder: str = None,
                      episode_number: str = None, episode_name: str = None,
                      category: str = None, furigana: str = None,
                      else_info: str = None, auto_send: str = None,
                      app_output_path: str = None,
                      app_output_path_format: str = None,
                      setting: str = None,
                      is_text_parser: int = None, text_parser_result: str = None,
                      parser_error: str = None,
                      edcb_tag: str = None, server_url: str = None,
                      auto_add_id: int = None,
                      addon: str = None) -> int:
        now = datetime.now().isoformat()
        # リスト列: list/スカラー → JSON 配列文字列（録画の見張りは Python list を渡す）
        title = _dump_list(title)
        folder = _dump_list(folder)
        episode_number = _dump_list(episode_number)
        episode_name = _dump_list(episode_name)
        category = _dump_list(category)
        furigana = _dump_list(furigana)
        app_output_path = _dump_list(app_output_path)
        setting = _dump_list(setting)
        conn = self._get_conn()
        cursor = conn.execute(
            """INSERT INTO recordings
               (addon, program_id, rec_id, onid, tsid, sid, eid, state,
                edcb_ts_path, host_ts_path, app_ts_path, amatsukaze_ts_path, konomitv_ts_path,
                rec_status, rec_comment,
                eit_start_time, eit_end_time,
                eit_title, eit_description, eit_extended_info, eit_station_name,
                eit_genre, eit_video_info, eit_audio_info,
                file_exist, file_size, duration_sec, drop_error,
                recording_start_time, recording_end_time,
                title, folder, episode_number, episode_name,
                category, furigana, else_info, auto_send,
                app_output_path, app_output_path_format, setting,
                is_text_parser, text_parser_result, parser_error,
                edcb_tag, server_url, auto_add_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (addon, program_id, rec_id, onid, tsid, sid, eid,
             edcb_ts_path, host_ts_path, app_ts_path, amatsukaze_ts_path, konomitv_ts_path,
             rec_status, rec_comment,
             eit_start_time, eit_end_time,
             eit_title, eit_description, eit_extended_info, eit_station_name,
             eit_genre, eit_video_info, eit_audio_info,
             file_exist, file_size, duration_sec, drop_error,
             recording_start_time, recording_end_time,
             title, folder, episode_number, episode_name,
             category, furigana, else_info, auto_send,
             app_output_path, app_output_path_format, setting,
             is_text_parser, text_parser_result, parser_error,
             edcb_tag, server_url, auto_add_id, now, now)
        )
        conn.commit()
        _emit('recording.added', {'recording_id': cursor.lastrowid, 'program_id': program_id,
                                  'title': eit_title, 'station_name': eit_station_name,
                                  'start_time': eit_start_time,
                                  'ts_path': app_ts_path or host_ts_path})
        return cursor.lastrowid


    def reset_scanning_recordings(self) -> int:
        """state=scanning の録画を pending に戻す（サーバー起動時のクラッシュ復旧用）。変更件数を返す。"""
        conn = self._get_conn()
        cur = conn.execute("UPDATE recordings SET state='pending' WHERE state='scanning'")
        conn.commit()
        return cur.rowcount

    def reset_encoding_recordings(self) -> int:
        """state=encoding の録画を queued に戻す（サーバー起動時のクラッシュ復旧用）。変更件数を返す。
        起動時は実エンコードは走っていないため encoding は全て stale。"""
        conn = self._get_conn()
        cur = conn.execute("UPDATE recordings SET state='queued' WHERE state='encoding'")
        conn.commit()
        return cur.rowcount


    def update_recording(self, rec_id: int, **fields):
        if not fields:
            return
        if 'parser_error' in fields and isinstance(fields['parser_error'], list):
            fields['parser_error'] = json.dumps(fields['parser_error'], ensure_ascii=False)
        # リスト列: list/スカラー → JSON 配列文字列
        for col in _LIST_COLS:
            if col in fields:
                fields[col] = _dump_list(fields[col])
        fields['updated_at'] = datetime.now().isoformat()
        set_clause = ', '.join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [rec_id]
        conn = self._get_conn()
        conn.execute(f"UPDATE recordings SET {set_clause} WHERE id = ?", values)
        conn.commit()
        _emit('recording.updated', {'recording_id': rec_id,
                                    'changed': [k for k in fields if k != 'updated_at']})
        # 録画/エンコードの失敗はそれ単体で購読したいことが多いので別イベントにする
        if str(fields.get('state') or '') in ('error', 'encode_error', 'non_file'):
            rec = self.get_recording(rec_id) or {}
            _emit('recording.failed', {
                'recording_id': rec_id, 'state': fields['state'],
                'title': rec.get('eit_title'), 'station_name': rec.get('eit_station_name'),
                'start_time': rec.get('eit_start_time'),
                # EDCB 側の録画結果(0=録画中/1=正常/2=エラー/3=中断/4=スキップ)。
                # 通知アドオンが「EDCBは正常終了なのにアプリ側で失敗」を選別できるようにする
                'rec_status': rec.get('rec_status'), 'rec_comment': rec.get('rec_comment') or '',
                'error': fields.get('error_message') or rec.get('error_message')
                         or rec.get('drop_error') or '',
            })

    def delete_recording(self, row_id: int):
        conn = self._get_conn()
        row = conn.execute("SELECT program_id FROM recordings WHERE id = ?", (row_id,)).fetchone()
        conn.execute("DELETE FROM recordings WHERE id = ?", (row_id,))
        # 紐づく program は、他に参照する recording が残らなければ同時に削除する
        program_id = row['program_id'] if row else None
        if program_id is not None and conn.execute(
                "SELECT 1 FROM recordings WHERE program_id = ? LIMIT 1", (program_id,)).fetchone() is None:
            conn.execute("DELETE FROM programs WHERE id = ?", (program_id,))
        conn.commit()

    def ignore_rec_id(self, rec_id: int):
        """rec_id を ignored_rec_ids に追加し、B-0 による再登録を防ぐ。"""
        conn = self._get_conn()
        conn.execute("INSERT OR IGNORE INTO ignored_rec_ids (rec_id) VALUES (?)", (rec_id,))
        conn.commit()

    def unignore_rec_id(self, rec_id: int):
        """ignored_rec_ids から rec_id を削除する（EDCB側も削除済みの場合に呼ぶ）。"""
        conn = self._get_conn()
        conn.execute("DELETE FROM ignored_rec_ids WHERE rec_id = ?", (rec_id,))
        conn.commit()


    def cleanup_missing_files(self) -> int:
        """host_ts_path が設定されているが存在しない recordings を削除。削除件数を返す。
        外部ディスク取り外し中（disk_offline）のパスは削除しない。"""
        import os
        rows = self._get_conn().execute(
            "SELECT id, rec_id, host_ts_path FROM recordings"
            " WHERE host_ts_path IS NOT NULL AND host_ts_path != ''"
        ).fetchall()
        deleted = 0
        for row in rows:
            if not os.path.exists(row['host_ts_path']):
                if self.disk_offline(row['host_ts_path']):
                    continue  # 外部ディスク取り外し中 → 削除しない
                if row['rec_id'] is not None:
                    self.ignore_rec_id(row['rec_id'])
                self.delete_recording(row['id'])
                deleted += 1
        return deleted
