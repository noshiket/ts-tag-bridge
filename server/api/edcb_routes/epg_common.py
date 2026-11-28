"""番組表の API で共通の扱い（見てよい局か・覚えてよい応答）"""

from quart import jsonify, abort
from api.routes.auth import perm


# 予約以外の準静的レスポンス(EPG/サービス/ロゴ)につけるブラウザキャッシュ期間（6時間）
_STATIC_CACHE_MAX_AGE = 6 * 3600


def require_station(onid, tsid, sid):
    if not perm().station(onid, tsid, sid):
        abort(403, description='この放送局は許可されていません')


def _cached_json(payload, per_user=False):
    """予約以外の準静的データ用。ブラウザに max-age でキャッシュさせる。

    per_user=True は利用者ごとに中身が変わるもの(放送局一覧・番組表)。
    public のままだと、同じブラウザで別の利用者に切り替えた時に前の利用者の
    キャッシュがそのまま出てしまうので、private + Vary: Cookie にする。
    """
    resp = jsonify(payload)
    scope = 'private' if per_user else 'public'
    resp.headers['Cache-Control'] = f'{scope}, max-age={_STATIC_CACHE_MAX_AGE}'
    if per_user:
        resp.headers['Vary'] = 'Cookie'
    return resp
