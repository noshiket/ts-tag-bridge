"""ProgramDB — SQLite CRUD for programs"""

import json
import logging

logger = logging.getLogger('db.rule_db')   # 分ける前と同じ名前で出す

# 複数値を持ちうるリスト型列（DB 上は JSON 配列文字列で保存）
# recordings は複数話を1レコードに保持しうるため title/folder/furigana/setting もリスト化する。
_LIST_COLS = frozenset({'title', 'folder', 'furigana', 'setting',
                        'episode_number', 'episode_name', 'category', 'app_output_path'})


def _to_list(v):
    """リスト列の値を Python list へ正規化する。
    None はそのまま / list はそのまま / JSON 配列文字列はパース /
    旧スカラー値は単要素 list にラップ（後方互換）。"""
    if v is None:
        return None
    if isinstance(v, list):
        return v
    if isinstance(v, str) and v.startswith('['):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return [v]


def _dump_list(v):
    """リスト列の値を JSON 配列文字列へ直列化する。None は None のまま。"""
    return json.dumps(_to_list(v), ensure_ascii=False) if v is not None else None

# 録画一覧（list_recordings）では使わない大容量 JSON ブロブ列。
# captions/comments/key_frames は1件あたり数 MB あり、全件 SELECT * すると数百 MB を
# 毎回メモリに載せてしまう（一覧の呼び出し元はいずれも未参照）。単一取得 get_recording は
# 従来どおり全列返すため、再生・詳細表示には影響しない。
_RECORDING_HEAVY_COLS = frozenset({
    'captions_json', 'comments_json', 'captions2_json', 'key_frames', 'frame_table',
    # CMカット解析は1件10KB前後。一覧の呼び出し元は使わず、要る画面は
    # /api/encode/recordings/<id>/cm_analysis で単体取得する
    'cm_analysis',
})


def _emit(event, payload):
    """アドオンのフェーズ通知。失敗してもDB操作を止めない。"""
    try:
        from logic.addons import addon_events
        addon_events.emit(event, payload)
    except Exception:
        pass
