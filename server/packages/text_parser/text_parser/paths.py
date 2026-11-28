"""パス・ファイル名に使う値の置き換え（setPath / sanitize_path_component）。"""

import datetime
import re

# ────────────── ファイル名サニタイズ ──────────────

_MULTI_CHAR_SUBS = [
    (re.compile(r'(?<![!?])!!(?![!?])'), '‼'),
    (re.compile(r'(?<![!?])!\?(?![!?])'), '⁉'),
]

_CHAR_TABLE = str.maketrans({
    '/':  '／',
    '\\': '＼',
    '!':  '！',
    '?':  '？',
    ':':  '：',
    '*':  '＊',
    '"':  '\u201d',  # "
    '<':  '＜',
    '>':  '＞',
    '|':  '｜',
})

# setPath テンプレート展開時にサニタイズをスキップするシステム変数
_PATH_PASSTHROUGH_VARS = frozenset({'encode_dir', 'ext'})


def _sanitize_filename_component(s: str) -> str:
    """ファイル名の1コンポーネントとして使えない文字を全角等に変換する"""
    s = re.sub(r'[\x00-\x1f]', '', s)
    for pattern, repl in _MULTI_CHAR_SUBS:
        s = pattern.sub(repl, s)
    s = s.translate(_CHAR_TABLE)
    s = s.rstrip(' .')
    return s


def sanitize_path_component(s: str) -> str:
    """フォルダ名/ファイル名をパス上の表記へ直す（'!' → '！' 等）。

    setPath の展開と同じ規則。DB上のフォルダ名と実際のディレクトリ名は
    この変換ぶんズレるので、パスを組み立て直す側（フォルダ一括変更など）も必ずこれを通す。
    """
    return _sanitize_filename_component(s)


def _format_start_time(s: str) -> str:
    """ISO 8601 の start_time を YYYYMMDD-HHmm 形式のファイル名安全な文字列に変換する"""
    try:
        dt = datetime.datetime.fromisoformat(s)
        return dt.strftime('%Y%m%d-%H%M')
    except (ValueError, TypeError, AttributeError):
        return _sanitize_filename_component(s)


def _sanitize_path_var(var: str, val: str) -> str:
    """変数名に応じてサニタイズまたはフォーマットを適用する"""
    if var in _PATH_PASSTHROUGH_VARS:
        return val
    if var == 'start_time':
        return _format_start_time(val)
    return _sanitize_filename_component(val)
