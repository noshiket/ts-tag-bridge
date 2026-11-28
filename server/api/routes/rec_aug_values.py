"""録画結果の値の直し方（JSON・ドロップの数・確定値の見せ方）"""

import json


def _json_or_none(v):
    """JSON文字列(または既にdict)を dict にする。読めなければ None。"""
    import json as _j
    if isinstance(v, dict):
        return v
    if not v:
        return None
    try:
        return _j.loads(v)
    except (ValueError, TypeError):
        return None


def _drop_counts(rec):
    """(ドロップ数, スクランブル数)。drop_error の JSON から、なければ EDCB の保存値。"""
    _de_raw = rec.get('drop_error')
    _drops = rec.get('rec_drops') or 0
    _scrambles = rec.get('rec_scrambles') or 0
    if _de_raw:
        try:
            _de = json.loads(_de_raw) if isinstance(_de_raw, str) else _de_raw
            _drops = _de.get('drop_count',
                sum(1 for e in (_de.get('errors') or []) if e.get('error_type') == 'PACKET_LOSS'))
            _scrambles = _de.get('scramble_count', 0)
        except Exception:
            pass
    return _drops, _scrambles


def _confirmed_view(rec) -> dict:
    """録画の確定値（画面の「確定値」欄に出すもの）。"""
    return {
        'title': rec.get('title'), 'folder': rec.get('folder'),
        'episode_name': rec.get('episode_name'), 'episode_number': rec.get('episode_number'),
        'category': rec.get('category'), 'furigana': rec.get('furigana'),
        'else_info': rec.get('else_info'), 'auto_send': rec.get('auto_send'),
        'app_output_path_format': rec.get('app_output_path_format'),
        'app_output_path': rec.get('app_output_path'), 'setting': rec.get('setting'),
        'encode_dir': rec.get('encode_dir'),
    }
