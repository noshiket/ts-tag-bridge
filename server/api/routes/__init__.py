"""API の共通部分。Blueprint(bp)・認証の確認・複数の機能で使う補助とキャッシュ。

各機能の API は api/*_routes/ にあり、bp と補助をここから読む。
もとは api/routes.py の1ファイル。中身ごとに分けた。"""

# bp はここで作る
from . import auth  # noqa: F401


# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助を api.routes.* から読むので、末尾で読み込む
from api import (  # noqa: E402,F401
    amatsukaze_routes,
    video_routes,
    encode_routes,
    stream_routes,
    pattern_routes,
    shoboi_routes,
    edcb_routes,
    system_routes,
    music,
    addons,
)
