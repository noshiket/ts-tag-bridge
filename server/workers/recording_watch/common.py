"""録画の見張りで共通の物（分割録画の名前・EDCB の録画状態）"""

import re as _re


# -(N) サフィックスのパターン: "program-(1).ts" → base "program.ts"
_PART_SUFFIX_RE = _re.compile(r'^(.*)-\(\d+\)(\.[^.]+)$')


def _base_path_if_suffixed(ts_path: str) -> str | None:
    """-(N) サフィックスを取り除いたベースパスを返す。サフィックスがなければ None。"""
    m = _PART_SUFFIX_RE.match(ts_path)
    return (m.group(1) + m.group(2)) if m else None


# EDCB の recStatus。0=録画中 / 1=正常 / 2=エラー / 3=中断 / 4=スキップ
_REC_STATUS_ERROR = 2
