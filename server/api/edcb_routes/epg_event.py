"""番組1件（EPG の詳細）"""

from quart import current_app, request, abort
from api.routes.auth import perm, bp, require_screen
from api.routes.epg_build import _build_epg_for_service, _build_tsid_map
from api.routes.edcb_call import _call, _client
from .epg_common import _cached_json, require_station


@bp.get('/epg/event')
def get_epg_event():
    """番組1件を全フィールド返す（番組表グリッドは no_ext=1 で取るため、詳細表示用）。

    ?service=ONID-TSID-SID&event_id=N
    """
    service = request.args.get('service')
    event_id = request.args.get('event_id', type=int)
    if not service or event_id is None:
        abort(400, description='service と event_id が必要です')
    try:
        onid, tsid, sid = map(int, service.split('-'))
    except ValueError:
        abort(400, description='service の形式が不正です')
    require_screen('epg')
    require_station(onid, tsid, sid)

    tsid_map = current_app.config.get('_tsid_sids')
    if not tsid_map:
        tsid_map = current_app.config['_tsid_sids'] = _build_tsid_map(_call(_client().enum_service))
    try:
        # 局単位のキャッシュ(6h)から拾うので、EDCB への問い合わせは通常発生しない
        result = _build_epg_for_service(_client(), onid, tsid, sid, basic=0, onair=None,
                                        tsid_map=tsid_map, write_cache=True)
    except Exception as e:
        abort(502, description=str(e))
    for ev in result:
        if ev.get('event_id') == event_id:
            paid = None if ev.get('free_ca') is None else not ev['free_ca']
            if not perm().program(paid, onid, tsid, sid):
                abort(403, description='有料の番組は許可されていません')
            return _cached_json(ev, per_user=True)
    abort(404, description='番組が見つかりません')
