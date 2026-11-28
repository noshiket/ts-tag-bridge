"""text_parser のパターンの API（/api/patterns/*）。

もとは api/pattern_routes.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import patterns, pattern_sync, analyze, text_tools, preview  # noqa: F401
