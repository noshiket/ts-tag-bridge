"""EDCB を呼ぶ口（失敗は 502 にする）と、局ごとの番組表の覚え"""

import threading
from quart import current_app, abort


# 局別 EPG キャッシュ（(service, basic) -> (ts, list)）。EDCB の EPG 更新は1日数回なので長め(6h)。
_epg_svc_cache: dict = {}


_epg_svc_cache_lock = threading.Lock()


def _client():
    return current_app.config['EDCB_CLIENT']


def _call(fn, *args, **kwargs):
    """EDCBClient メソッド呼び出しの共通エラーハンドラ"""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        abort(502, description=str(e))
