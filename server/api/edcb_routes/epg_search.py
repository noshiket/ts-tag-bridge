"""番組検索"""

from quart import jsonify, request
from api import schemas
from api.routes.auth import bp, perm
from api.routes.edcb_call import _call, _client
from api.routes.caches import _json


@bp.get('/search')
def search_events():
    """番組検索（URL クエリパラメータ形式）。
    放送局絞り込み: ?service=ONID-TSID-SID を複数指定可（省略時は全局）
    date: "曜-HH:MM-曜-HH:MM" を複数指定可（?date=月-20:00-月-21:00&date=火-20:00-火-21:00）
    content: nibble 値を複数指定可（?content=1792&content=1800）
    """
    service_list      = request.args.getlist('service') or None
    content_raw       = request.args.getlist('content')
    content_list      = [int(v) for v in content_raw if v.isdigit()] or None
    not_content_flag  = request.args.get('not_content_flag', '0') != '0'
    notkey            = request.args.get('not_key')
    free_ca_flag  = request.args.get('free_ca_flag', type=int)
    dur_min       = request.args.get('chk_duration_min', type=int)
    dur_max       = request.args.get('chk_duration_max', type=int)
    days          = request.args.get('days', 0, type=int)

    andkey       = request.args.get('and_key')
    reg_exp_flag = request.args.get('reg_exp_flag', '0') != '0'
    title_only   = request.args.get('title_only_flag', '0') != '0'
    aimai_flag   = request.args.get('aimai_flag', '0') != '0'

    client = _client()
    items = _call(
        client.search_event,
        andkey=andkey or '',
        notkey=notkey or None,
        reg_exp_flag=reg_exp_flag,
        title_only_flag=title_only,
        aimai_flag=aimai_flag,
        service_list=service_list,
        content_list=content_list,
        not_content_flag=not_content_flag,
        free_ca_flag=free_ca_flag,
        chk_duration_min=dur_min,
        chk_duration_max=dur_max,
        days=days,
    )

    client._load_service_map()
    return jsonify(perm().filter_items([
        schemas.event_to_response(e, client._service_map.get((e['onid'], e['tsid'], e['sid']), ''))
        for e in items
    ]))


@bp.post('/search')
async def search_events_post():
    """番組検索（JSON ボディ形式）。
    POST /api/auto_add と同じ JSON フォーマットで検索条件を指定できる。
    auto_add ルール作成前の条件確認に使用する。
    """
    body = await _json()
    kwargs = schemas.parse_search_request(body)
    client = _client()
    items = _call(client.search_event, **kwargs)
    client._load_service_map()
    return jsonify(perm().filter_items([
        schemas.event_to_response(e, client._service_map.get((e['onid'], e['tsid'], e['sid']), ''))
        for e in items
    ]))
