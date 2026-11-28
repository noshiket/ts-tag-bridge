"""チューナーとその予約・局ロゴ"""

import data_paths
from quart import jsonify, request, abort, Response
from api import schemas
from api.routes.auth import bp
from api.routes.edcb_call import _call, _client
from .epg_common import _STATIC_CACHE_MAX_AGE
from .epg import _crop_169, _logo_cache


@bp.get('/tuners')
def get_tuners():
    """EDCB のチューナーの状態。"""
    items = _call(_client().get_tuner_status)
    return jsonify([schemas.tuner_to_response(t) for t in items])


@bp.get('/tuner_reserves')
def get_tuner_reserves():
    """チューナーごとに割り当てられた予約。"""
    items = _call(_client().enum_tuner_reserve_info)
    return jsonify([schemas.tuner_reserve_to_response(t) for t in items])


@bp.get('/logo')
def get_logo():
    """局ロゴ取得プロキシ。?onid=<onid>&sid=<sid>
    ブラウザキャッシュ: Cache-Control public 1日。
    ロゴなし(1x1 GIF)は 204 を返してキャッシュさせる。
    """
    try:
        onid = int(request.args['onid'])
        sid  = int(request.args['sid'])
    except (KeyError, ValueError):
        abort(400, description='onid and sid required')

    key = (onid, sid)
    if key not in _logo_cache:
        import pathlib as _pl
        logo_dir = _pl.Path(data_paths.DATA_DIR) / 'station_logo'
        # ユーザー配置のロゴパック(NID{onid}-SID{sid}.png)を優先。sid のゼロ詰め(3桁)も許容。
        named = logo_dir / f'NID{onid}-SID{sid}.png'
        if not named.exists():
            named = logo_dir / f'NID{onid}-SID{sid:03d}.png'
        local = sorted(logo_dir.glob(f'{onid}_{sid}_*.png'))
        if named.exists():
            # ユーザー配置ロゴ(256x256等)は中央16:9にトリムして元キャッシュと比率を揃える
            _logo_cache[key] = _crop_169(named.read_bytes())
        elif local:
            best = max(local, key=lambda p: p.stat().st_size)
            _logo_cache[key] = best.read_bytes()
        else:
            data = _call(_client().get_logo, onid, sid)
            # 1x1透明GIF(43バイト程度)はロゴなし
            _logo_cache[key] = None if (data[:3] == b'GIF' and len(data) < 64) else data

    cache_hdr = f'public, max-age={_STATIC_CACHE_MAX_AGE}'
    data = _logo_cache[key]
    if data is None:
        return Response('', status=204, headers={'Cache-Control': cache_hdr})

    if   data[:4] == b'\x89PNG': mime = 'image/png'
    elif data[:3] == b'GIF':    mime = 'image/gif'
    elif data[:2] == b'BM':     mime = 'image/bmp'
    else:                        mime = 'image/jpeg'
    return Response(data, content_type=mime, headers={'Cache-Control': cache_hdr})
