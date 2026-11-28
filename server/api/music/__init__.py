"""音楽の API（/api/music/*。アルバム・プレイリスト）"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import music_routes, music_playlists  # noqa: F401
