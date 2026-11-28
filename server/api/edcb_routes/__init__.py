"""番組表・予約・EDCB の API（/api/epg/*, /api/reserves/*, /api/auto_add/*, /api/manu_add/* ほか）。

もとは api/edcb_routes.py の1ファイル。機能ごとに分けた。Blueprint(bp) と共通の補助は api.routes にある。"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import epg, epg_event, rec_setting_options, epg_search, reserves, reserve_aug, manu_add, tuners, logo  # noqa: F401
