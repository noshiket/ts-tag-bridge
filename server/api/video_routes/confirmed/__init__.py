"""確定値・tag.json・再解析・メタ情報

もとは video_routes/confirmed.py の1ファイル。中身ごとに分けた。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import tag, compare_candidates, broadcast_lookup, meta  # noqa: F401
