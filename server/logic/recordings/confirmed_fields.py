"""確定値の項目を並べる（解析結果の全部・足りない物）"""
from .confirmed_values import _KEY_TO_COL, _PLACEHOLDER_OK_COLS, _has_placeholder, _s, is_empty, needs_fill

def all_fields(tp: dict, table: str) -> dict:
    """解析結果の確定値をすべて返す（値が無いキーは含めない）＝上書き用。

    パターンを直して parser_error が解消した時は、確定値に残っている古い値
    （誤った解析結果）ごと新しい結果へ更新する必要があるため、空欄補完ではなく
    こちらを使う。録画側 add_recording の _write_confirmed と同じ考え方。
    """
    if not tp:
        return {}
    fields = {}
    for key, col in _KEY_TO_COL:
        v = _s(tp.get(key))
        if v is not None:
            fields[col] = v
    if tp.get('auto_send') is not None:
        fields['auto_send'] = ((1 if tp['auto_send'] else 0) if table == 'programs'
                               else ('true' if tp['auto_send'] else 'false'))
    return fields


def missing_fields(row: dict, tp: dict, table: str) -> dict:
    """row(programs/recordings の行) の空欄の確定値を tp で埋める更新 dict を返す。

    既に値がある列は対象にしない（手動修正を上書きしない）。
    例外として未展開のプレースホルダ（'{$folder}' 等）は無効値なので埋め直す。
    table: 'programs' | 'recordings'
    """
    if not row or not tp:
        return {}
    fields = {}
    for key, col in _KEY_TO_COL:
        new = tp.get(key)
        # 解析結果側が空/未展開なら書かない（空欄を空欄で埋めても意味がない）
        if is_empty(new) or (col not in _PLACEHOLDER_OK_COLS and _has_placeholder(new)):
            continue
        if needs_fill(col, row.get(col)):
            fields[col] = _s(new)
    if tp.get('auto_send') is not None and row.get('auto_send') is None:
        fields['auto_send'] = ((1 if tp['auto_send'] else 0) if table == 'programs'
                               else ('true' if tp['auto_send'] else 'false'))
    return fields
