"""録画・エンコード・ルールの API（/api/encode/*, /api/recordings/*, /api/rules/*, /api/auto_encode/*）。

もとは api/encode_routes.py の1ファイル。機能ごとに分けた。Blueprint(bp) と共通の補助は api.routes にある。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import recordings, recording_analysis, cm_analysis, auto_encode_rules, rule_auto_add, rules, rule_sync, register, frame_images, frame_tables, recording_stream, frames, scan, recording_patch, scan_eit, scan_eit_head, encodings, encodings_by_id, encoding_split, queue  # noqa: F401
