"""予約(rules)・エンコード・録画の応答の形"""

from .edcb import (  # noqa: F401
    _parse_json,
)


# ---------------------------------------------------------------------------
# ルール系（Phase 2）
# ---------------------------------------------------------------------------

def rule_to_response(row: dict, recordings: list = None) -> dict:
    """programs DB 行 → JSON レスポンス"""
    return {
        'id':                 row['id'],
        'reserve_id':         row.get('reserve_id'),
        'reserve_key':        row.get('reserve_key', ''),
        'original_title':         row.get('original_title', ''),
        'original_description':   row.get('original_description', ''),
        'original_extended_info': row.get('original_extended_info', ''),
        'station_name':           row.get('station_name', ''),
        'start_time':         row.get('start_time'),
        'expected_end_time':  row.get('expected_end_time'),
        'text_parser_result': row.get('text_parser_result') or {},
        'state':              row.get('state', ''),
        'recordings':         recordings if recordings is not None else [],
        'error_message':      row.get('error_message', ''),
        'created_at':         row.get('created_at'),
        'updated_at':         row.get('updated_at'),
        # text_parser 解析結果（反映後の確定値）
        'title':              row.get('title'),
        'folder':             row.get('folder'),
        'episode_name':       row.get('episode_name'),
        'episode_number':     row.get('episode_number'),
        'category':           row.get('category'),
        'furigana':           row.get('furigana'),
        'else_info':          row.get('else_info'),
        'auto_send':          row.get('auto_send'),
        'is_text_parser':     row.get('is_text_parser'),
        'app_output_path':    row.get('app_output_path'),
        'app_output_path_format': row.get('app_output_path_format'),
        'setting':            row.get('setting'),
        'genre':              row.get('genre', ''),
        'video_info':         row.get('video_info', ''),
        'audio_info':         row.get('audio_info', ''),
    }


def parse_rule_update(body: dict) -> dict:
    """PATCH /api/rules/<id> のボディ → DB update 用 dict

    直接変更を許可するフィールド:
      text_parser_result, state, error_message
      + text_parser 解析結果の確定値フィールド群
    text_parser_result の個別フィールド更新は parse_result キーで受け付ける。
    """
    # 注意: programsテーブルにencode_dir列は無い(録画単位の値)。許可すると
    # update_ruleの動的UPDATEがno such columnで全体失敗し何も保存されなくなる。
    allowed = {
        'text_parser_result', 'state', 'error_message',
        'title', 'folder', 'episode_name', 'episode_number',
        'category', 'furigana', 'else_info', 'auto_send',
        'is_text_parser', 'app_output_path', 'app_output_path_format',
        'setting', 'parser_error',
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if 'parse_result' in body and isinstance(body['parse_result'], dict):
        fields['text_parser_result'] = body['parse_result']
    return fields


def recording_to_response(row: dict) -> dict:
    """recordings DB 行 → JSON レスポンス"""
    return {
        'id':               row['id'],
        'program_id':       row['program_id'],
        'rec_id':           row.get('rec_id'),
        'onid':             row.get('onid'),
        'tsid':             row.get('tsid'),
        'sid':              row.get('sid'),
        'eid':              row.get('eid'),
        'state':            row.get('state', ''),
        'shimakaze_job_id': row.get('shimakaze_job_id'),
        'output_path':      row.get('output_path', ''),
        'error_message':    row.get('error_message', ''),
        'title':            row.get('title', ''),
        'folder':           row.get('folder', ''),
        'episode_number':   row.get('episode_number', ''),
        'episode_name':     row.get('episode_name', ''),
        'category':         row.get('category', ''),
        'eit_title':        row.get('eit_title', ''),
        'eit_description':  row.get('eit_description', ''),
        'eit_extended_info': row.get('eit_extended_info', ''),
        'eit_start_time':   row.get('eit_start_time', ''),
        'eit_end_time':     row.get('eit_end_time', ''),
        'station_name':     row.get('station_name', ''),
        'edcb_ts_path':     row.get('edcb_ts_path', ''),
        'host_ts_path':     row.get('host_ts_path', ''),
        'app_ts_path':      row.get('app_ts_path', ''),
        'amatsukaze_ts_path': row.get('amatsukaze_ts_path', ''),
        'file_exist':            bool(row['file_exist']) if row.get('file_exist') is not None else None,
        'recording_start_time':  row.get('recording_start_time', ''),
        'recording_end_time':    row.get('recording_end_time', ''),
        'drop_error':            _parse_json(row.get('drop_error')),
        'created_at':       row.get('created_at'),
        'updated_at':       row.get('updated_at'),
    }
