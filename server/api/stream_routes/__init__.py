"""再生の配信の API（/api/streams/*）。

もとは api/stream_routes.py の1ファイル。機能ごとに分けた。Blueprint(bp) と共通の補助は api.routes にある。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import live, live_extras, recording_hls, captures, vdb, recording, live_hls  # noqa: F401
