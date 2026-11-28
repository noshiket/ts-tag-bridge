"""エンコードの応答の形（失敗した工程・アドオンの工程・できた動画）"""

import json as _json
from quart import current_app


def _encoding_failed_state(row: dict):
    """encode_info.failed_state(どの工程で失敗したか)を取り出す。

    画面はこれより先の工程をやり直し先に出さない。
    """
    raw = row.get('encode_info')
    if not raw:
        return None
    try:
        ei = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None
    return (ei or {}).get('failed_state') if isinstance(ei, dict) else None


def _encoding_addon_step(row: dict):
    """encode_info.addon_step(アドオンエンコーダーの現在ステップ名)を取り出す。"""
    raw = row.get('encode_info')
    if not raw:
        return None
    try:
        ei = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None
    return (ei or {}).get('addon_step') if isinstance(ei, dict) else None


def _encoding_video_id(row: dict):
    """完了した encoding の出力先に対応する video.db の id を返す（無ければ None）。

    進捗画面から完成した動画へ飛べるようにするため。app_output_path は
    {$encode_dir} のプレースホルダを含みうるので、encode_dir で解決してから照合する。
    """
    if row.get('state') != 'encode_end':
        return None
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return None
    try:
        from logic.encode_pipeline.common import _apply_encode_dir
        path = _apply_encode_dir(row.get('app_output_path') or '', row.get('encode_dir'))
        if not path:
            return None
        # {$episode_number} 等が解決されないまま出力されている動画もあり、その場合
        # videos.file_path 側にも同じ文字列が入っているので、そのまま突き合わせる
        return db.find_video_id_by_path(path)
    except Exception:
        return None


def encoding_to_response(row: dict) -> dict:
    """encodings DB 行 → JSON レスポンス"""
    return {
        # 完了した encoding から生成された動画（進捗画面のリンク用。未登録なら null）
        'video_id':                 _encoding_video_id(row),
        'id':                       row['id'],
        'recording_id':             row['recording_id'],
        'order_index':              row.get('order_index', 0),
        'episode_idx':              row.get('episode_idx', 0),
        'episode_count':            row.get('episode_count'),
        'priority':                 row.get('priority', 3),
        # エンコードを始めた時刻（時差付き。画面が実行中の残り時間を出すのに使う。記録前の行は null）
        'encoding_started_at':      row.get('encoding_started_at'),
        # アドオンエンコーダーの現在ステップ名(進捗画面に表示。Amatsukazeではnull)
        'addon_step':               _encoding_addon_step(row),
        'state':                    row.get('state', ''),
        # どの工程で失敗したか（画面はこれより先をやり直し先に出さない）
        'failed_state':             _encoding_failed_state(row),
        'title':                    row.get('title') or '',
        'folder':                   row.get('folder') or '',
        'category':                 row.get('category') or '',
        'furigana':                 row.get('furigana') or '',
        'sid':                      row.get('sid'),
        'onid':                     row.get('onid'),
        'episode_number':           row.get('episode_number') or '',
        'episode_name':             row.get('episode_name') or '',
        'app_output_path':          row.get('app_output_path') or '',
        'encode_dir':               row.get('encode_dir') or '',
        'eit_start_time':           row.get('eit_start_time') or '',
        'eit_end_time':             row.get('eit_end_time') or '',
        'segments':                 row.get('segments') or '',
        'trim_segments': row.get('trim_segments') or '',
        'recording_start_time':     row.get('recording_start_time') or '',
        'recording_end_time':       row.get('recording_end_time') or '',
        'analyzed_recording_start_time': row.get('analyzed_recording_start_time') or '',
        'analyzed_recording_end_time':   row.get('analyzed_recording_end_time') or '',
        'analyzed_comment_count':        row.get('analyzed_comment_count'),
        'created_at':               row.get('created_at'),
        'updated_at':               row.get('updated_at'),
        'error_message':            row.get('error_message') or '',
        'progress':                 row.get('progress', 0.0),
    }
