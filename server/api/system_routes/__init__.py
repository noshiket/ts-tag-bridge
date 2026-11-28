"""サーバーの設定・状態・ログほかの API（/api/config/*, /api/status, /api/logs/*, /api/debug/* ほか）。

もとは api/system_routes.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import config_edit, system_ops, config, mylist, debug, api_docs  # noqa: F401
from .peers import _auto_seed_new_peers  # noqa: F401
