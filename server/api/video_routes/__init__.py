"""ライブラリの動画の API（/api/videos/* ほか）。

もとは api/video_routes.py の1ファイル。機能ごとに分けた。Blueprint(bp) と共通の補助は api.routes にある。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import library, add_video, tag_import, frames, download, audioviz, covers, media, thumbnails, confirmed, audio_sync, announce, video_reparse, lookup, jikkyo_forces, relocate  # noqa: F401
from .audio_sync.apply_ranges import _do_audio_compare_apply  # noqa: F401
from .tracks import _update_video_json_cols  # noqa: F401
