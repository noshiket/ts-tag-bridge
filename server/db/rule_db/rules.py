"""予約（programs）"""

import json
from datetime import datetime
from typing import Optional, List
from .common import (  # noqa: F401
    _LIST_COLS,
    _dump_list,
    _emit,
)


class _RulesMixin:
    """ProgramDB の一部（予約（programs））。"""

    def add_rule(self, reserve_id: int, reserve_key: str, original_title: str,
                 station_name: str, start_time: str, expected_end_time: str,
                 text_parser_result: dict, state: str,
                 original_description: str = '', original_extended_info: str = '',
                 start_margin: int = None, end_margin: int = None,
                 title: str = None, folder: str = None,
                 episode_name: str = None, episode_number: str = None,
                 category: str = None, furigana: str = None,
                 else_info: str = None, auto_send: int = None,
                 is_text_parser: int = None,
                 app_output_path: str = None,
                 app_output_path_format: str = None,
                 setting: str = None,
                 genre: str = None,
                 video_info: str = None,
                 audio_info: str = None,
                 edcb_tag: str = None,
                 server_url: str = None,
                 parser_error=None,
                 auto_add_id: int = None,
                 sid: int = None, ch: str = None) -> int:
        now = datetime.now().isoformat()
        result_json = json.dumps(text_parser_result, ensure_ascii=False) \
            if isinstance(text_parser_result, dict) else (text_parser_result or '{}')
        if isinstance(parser_error, list):
            pe_json = json.dumps(parser_error, ensure_ascii=False)
        elif isinstance(parser_error, str):
            pe_json = parser_error
        else:
            pe_json = '[]'
        # リスト列: list/スカラー → JSON 配列文字列
        title = _dump_list(title)
        folder = _dump_list(folder)
        episode_name = _dump_list(episode_name)
        episode_number = _dump_list(episode_number)
        category = _dump_list(category)
        furigana = _dump_list(furigana)
        app_output_path = _dump_list(app_output_path)
        setting = _dump_list(setting)
        conn = self._get_conn()
        cursor = conn.execute("""
            INSERT INTO programs
                (reserve_id, reserve_key, original_title, station_name, start_time,
                 expected_end_time, text_parser_result, parser_error,
                 original_description, original_extended_info,
                 state, start_margin, end_margin,
                 title, folder, episode_name, episode_number,
                 category, furigana, else_info, auto_send,
                 is_text_parser, app_output_path, app_output_path_format,
                 setting, genre, video_info, audio_info, edcb_tag, server_url, auto_add_id, sid, ch, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (reserve_id, reserve_key, original_title, station_name, start_time,
              expected_end_time, result_json, pe_json,
              original_description, original_extended_info,
              state, start_margin, end_margin,
              title, folder, episode_name, episode_number,
              category, furigana, else_info, auto_send,
              is_text_parser, app_output_path, app_output_path_format,
              setting, genre, video_info, audio_info, edcb_tag, server_url, auto_add_id, sid, ch, now, now))
        conn.commit()
        _emit('program.added', {'program_id': cursor.lastrowid, 'reserve_id': reserve_id,
                                'title': original_title, 'station_name': station_name,
                                'start_time': start_time})
        return cursor.lastrowid

    def get_by_reserve_id(self, reserve_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM programs WHERE reserve_id = ?", (reserve_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def get_by_key(self, reserve_key: str) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM programs WHERE reserve_key = ?", (reserve_key,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_rules(self, state: str = None) -> List[dict]:
        if state:
            rows = self._get_conn().execute(
                "SELECT * FROM programs WHERE state = ? ORDER BY id DESC", (state,)
            ).fetchall()
        else:
            rows = self._get_conn().execute(
                "SELECT * FROM programs ORDER BY id DESC"
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_rule(self, rule_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM programs WHERE id = ?", (rule_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def update_rule(self, rule_id: int, **fields):
        if not fields:
            return
        if 'text_parser_result' in fields and isinstance(fields['text_parser_result'], dict):
            fields['text_parser_result'] = json.dumps(fields['text_parser_result'], ensure_ascii=False)
        if 'parser_error' in fields and isinstance(fields['parser_error'], list):
            fields['parser_error'] = json.dumps(fields['parser_error'], ensure_ascii=False)
        # リスト列: list/スカラー → JSON 配列文字列
        for col in _LIST_COLS:
            if col in fields:
                fields[col] = _dump_list(fields[col])
        fields['updated_at'] = datetime.now().isoformat()
        set_clause = ', '.join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [rule_id]
        conn = self._get_conn()
        conn.execute(f"UPDATE programs SET {set_clause} WHERE id = ?", values)
        conn.commit()
        _emit('program.updated', {'program_id': rule_id,
                                  'changed': [k for k in fields if k != 'updated_at']})

    def set_auto_add_id(self, rule_id: int, auto_add_id: Optional[int]) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE programs SET auto_add_id = ?, updated_at = ? WHERE id = ?",
            (auto_add_id, datetime.now().isoformat(), rule_id)
        )
        conn.commit()

    def list_pending_past_end(self) -> List[dict]:
        """state='pending' または 'matched' かつ expected_end_time < 現在時刻 のルールを返す"""
        now = datetime.now().isoformat()
        rows = self._get_conn().execute(
            "SELECT * FROM programs WHERE state IN ('pending', 'matched') AND expected_end_time < ?",
            (now,)
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def delete_rule(self, rule_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM programs WHERE id = ?", (rule_id,))
        conn.commit()
