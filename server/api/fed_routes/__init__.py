"""ノード間の連携の API（/api/fed/*）。X-Fed-Token で認証する。

もとは api/fed_routes.py の1ファイル。中身ごとに分けた。"""
from .common import _manifest_path, fed_bp  # noqa: F401
# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import ingest, ingest_finalize, recording_finalize, recording  # noqa: F401
