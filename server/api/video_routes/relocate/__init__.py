"""移動と重複の許可（/api/videos/<id>/relocate ほか）

もとは video_routes/relocate.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import rename, move  # noqa: F401
