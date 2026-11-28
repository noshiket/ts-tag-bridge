"""認証・利用者の設定・視聴履歴・利用者の管理の API（/api/auth/*, /api/users/*）。

もとは api/auth_routes.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import auth, prefs, watch, admin  # noqa: F401
