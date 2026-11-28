"""録画の再生（/api/streams/video/*）。HLS の共通処理もここ

もとは stream_routes/recording.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import metadata, playback, playback_meta, vdb_meta  # noqa: F401
