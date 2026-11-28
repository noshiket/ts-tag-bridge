"""エンコードする前に、出力先が決まっているかを見る（無いと最後のコピーで必ず失敗する）"""

import json

from .placeholders import _list_val


def _episodes_without_output(recording: dict, n: int) -> list:
    """出力先（確定値の app_output_path）が空の話の番号（1から）。SKIP の話は見ない"""
    segs = recording.get('segments')
    if isinstance(segs, str):
        try:
            segs = json.loads(segs)
        except Exception:
            segs = None
    out = []
    for i in range(n):
        seg = segs[i] if isinstance(segs, list) and i < len(segs) else None
        if isinstance(seg, str) and ',SKIP' in seg:
            continue
        if not _list_val(recording, 'app_output_path', i):
            out.append(i + 1)
    return out


def output_missing_reason(recording: dict) -> 'str | None':
    """出力先の無い話があれば、エンコードキューに載せない理由（無ければ None）"""
    segs = recording.get('segments')
    if isinstance(segs, str):
        try:
            segs = json.loads(segs)
        except Exception:
            segs = None
    missing = _episodes_without_output(recording, len(segs) if isinstance(segs, list) and segs else 1)
    if not missing:
        return None
    return (f'出力先(app_output_path)の確定値が未設定です（{"・".join(map(str, missing))}話目）。'
            '確定値を設定してからキューに登録してください')
