"""Amatsukaze を呼ぶ口（サーバーを選ぶ・失敗は 502 にする）"""

from quart import current_app, abort
from api.routes.media import _amz


def _amz_for(url: str):
    """?url= / body.url で Amatsukaze サーバーを選ぶ。

    任意の URL を受けると外部への踏み台になるので、**config の
    amatsukaze_servers に載っているものだけ**通す。未指定なら既定のクライアント。
    """
    if not url:
        return _amz()
    cfg = current_app.config.get('ENCODE_AUTO') or {}
    known = {(s.get('url') or '').rstrip('/')
             for s in (cfg.get('amatsukaze_servers') or [])}
    for k in ('amatsukaze_url', 'Amatsukaze_url'):
        if cfg.get(k):
            known.add(str(cfg[k]).rstrip('/'))
    if url.rstrip('/') not in known:
        abort(400, description='設定に無い Amatsukaze サーバーです')
    from clients.amatsukaze_api.core import AmatsukazeClient
    return AmatsukazeClient(url)


def _amz_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        abort(502, description=str(e))
