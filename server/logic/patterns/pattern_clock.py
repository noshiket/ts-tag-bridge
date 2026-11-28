"""パターンごとの最後に変えた時刻（同期の後勝ちに使う）。

接続が切れている間に両方のサーバーで同じパターンを変えると、つながった後にそれぞれの変更が相手へ届く。
届いた順に当てると、後から届いた古い変更が新しい変更を上書きする。変更には変えた時刻（at）を付けて送り、
受け側はそのパターンをそれより後に変えていれば当てない（後に変えた方が両方に残る）。

data/pattern_clock.json に {SID: {"pattern\\tpattern2": 時刻}} で持つ（パターンのファイルには入れない）。
"""

import json
import os
import threading

from data_paths import DATA_DIR

_PATH = os.path.join(DATA_DIR, 'pattern_clock.json')
_lock = threading.Lock()


def _key(pattern: str, pattern2: str = '') -> str:
    return f'{pattern or ""}\t{pattern2 or ""}'


def _load() -> dict:
    try:
        with open(_PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def keys_of(payload: dict, normalize) -> list:
    """変更が触るパターン（新しいもの・置き換え元・消すもの）。normalize は TextParser._normalize_brackets"""
    out = []
    for d in (payload.get('analyzer'), payload.get('replace'), payload.get('match')):
        if isinstance(d, dict) and d.get('pattern') is not None:
            out.append(_key(normalize(d.get('pattern', '')), d.get('pattern2', '')))
    return out


def is_stale(sid: int, keys: list, at: float) -> bool:
    """このサーバーで、どれかのパターンを at より後に変えている"""
    with _lock:
        known = _load().get(str(sid), {})
    return any(known.get(k, 0) > at for k in keys)


def stamp(sid: int, keys: list, at: float) -> None:
    with _lock:
        clock = _load()
        mine = clock.setdefault(str(sid), {})
        for k in keys:
            mine[k] = max(mine.get(k, 0), at)
        tmp = _PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(clock, f, ensure_ascii=False)
        os.replace(tmp, _PATH)
