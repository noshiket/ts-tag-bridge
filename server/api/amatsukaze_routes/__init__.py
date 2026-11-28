"""Amatsukaze の操作の API（/api/amatsukaze/*）。

もとは api/amatsukaze_routes.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import queue, logs, settings, logo_analyze, proxy  # noqa: F401
