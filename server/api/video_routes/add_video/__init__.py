"""動画の追加（手動・アップロード・tag.json から・取り込み・音楽）

もとは video_routes/add_video.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import media, music, add  # noqa: F401
