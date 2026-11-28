"""アドオンが自分で持つ API の口の中継（/api/addons/<名前>/api/<サブパス>）。

コアはアドオンの名前も口も知らず、アドオンの API 表（logic/addons/addon_runner/api_table）を見て呼ぶ。
アドオンは再起動なしで読み直すので、口を足しても直しても次の呼び出しから効く。
"""

import asyncio
import inspect

from quart import abort, jsonify, request
from api.routes.auth import bp
from api.routes.caches import _require_admin
from logic.addons.addon_runner.api_table import METHODS, AddonApiRequest, api_table


@bp.route('/addons/<name>/api/<path:sub>', methods=list(METHODS))
async def call_addon_api(name, sub):
    """アドオンが API 表（API = {'GET status': 関数, ...}）で持つ口を呼ぶ。
    無効にしたアドオンは 503。口ごとの説明は、この一覧の「addons」の組に口ごとに出る。
    返り値は JSON（関数が (値, 状態コード) を返せばその状態コード）。"""
    from api.auth_routes.auth import current_user
    from logic.addons import addon_events, addon_runner  # noqa: F401
    from logic.addons import addon_settings
    try:
        mod, schema, _spdir = addon_runner.load_addon(name)
        table = api_table(mod)
    except ValueError as e:
        abort(404, description=str(e))
    route = table.get((request.method, sub.strip('/')))
    if route is None:
        abort(404, description=f'アドオン {name} に {request.method} {sub} はありません')
    if route['auth'] == 'admin':
        _require_admin()
    conf = addon_settings.load_settings(name, addon_settings.default_enabled(schema['target']))
    if not conf['enabled']:
        abort(503, description=f'アドオン {name} が無効です')
    params = {p['key']: p.get('default') for p in schema['settings_params']}
    params.update(conf['params'])
    body = await request.get_json(silent=True) if request.method != 'GET' else None
    req = AddonApiRequest(addon=name, method=request.method, path=sub.strip('/'),
                          args=request.args.to_dict(), body=body if isinstance(body, dict) else {},
                          params=params, user=dict(current_user() or {}) or None)
    try:
        result = await asyncio.to_thread(route['fn'], req)
        if inspect.isawaitable(result):
            result = await result
    except Exception as e:
        abort(502, description=f'{schema["label"]} の {request.method} {sub} が失敗しました: {e}')
    status = 200
    if isinstance(result, tuple) and len(result) == 2:
        result, status = result
    return jsonify(result), status
