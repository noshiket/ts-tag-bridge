"""一覧・アルバム・シリーズ・カテゴリ（/api/videos/albums, /series, /list ほか）

もとは video_routes/library.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import manual_defaults, deletion, albums, lists  # noqa: F401
