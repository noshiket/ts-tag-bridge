"""音声比較・ずれの測り直し・取り込み（/api/videos/<id>/audio-compare ほか）

もとは video_routes/audio_sync.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import jobs, apply, apply_ranges  # noqa: F401
