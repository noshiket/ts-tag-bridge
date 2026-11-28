"""録画の一覧・手動追加・掃除（/api/recordings/*, /api/encode/options）

もとは encode_routes/recordings.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import augmented, deletion, listing, manual, maintenance  # noqa: F401
