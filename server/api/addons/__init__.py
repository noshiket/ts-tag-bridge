"""アドオンの API（/api/addons/*。一覧・設定・出したファイル・検索・アドオンが持つ口）"""

# 読み込むと API の口などが登録される（同じ名前を別の所から読まないよう、すぐ下のものだけを並べる）
from . import addon_routes, addon_api, addon_files, addon_search, addon_i18n  # noqa: F401
