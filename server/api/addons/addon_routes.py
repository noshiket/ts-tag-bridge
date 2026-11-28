"""アドオン（/api/addons/*）。

api/routes.py から分けた。Blueprint(bp) と共通の補助は api.routes にある。
"""

import asyncio
from quart import jsonify, current_app, request, abort

from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401


# ---------------------------------------------------------------------------
# アドオン（server/addon/*.py をスキーマ読み取りで実行。videoの…メニューから使用）
# ---------------------------------------------------------------------------

@bp.get('/addons')
def list_addons_api():
    """アドオン一覧(スキーマ)。?target= で用途種別を絞る(videoカードは?target=video)。

    設定画面で無効にしたアドオンは返さない(設定画面自体は /addons/settings を使う)。"""
    from logic.addons import addon_runner
    from api.routes.auth import perm
    items = addon_runner.list_addons(target=request.args.get('target'), only_enabled=True)
    # 番組表のアドオンは、許可された物だけ（利用者ごとの権限の guides。中継では中継元の利用者の権限）
    p = perm()
    return jsonify([a for a in items if a.get('target') != 'guide' or p.guide(a.get('name'))])


@bp.post('/addons/<name>/install')
async def install_addon_requirements(name):
    """アドオンの requirements.txt を導入する（設定画面の「インストール」ボタン）。

    依存ライブラリが無くて読み込みに失敗しているアドオンを、その場で使えるようにする。
    サーバーと同じ interpreter の pip を使うので venv の外へは入らない。
    """
    from logic.addons import addon_runner
    reqs = addon_runner.requirements_of(name)
    if reqs is None:
        abort(404, description=f'アドオン {name} に requirements.txt はありません')
    res = await asyncio.to_thread(addon_runner.install_requirements, name)
    after = addon_runner.requirements_of(name)
    return jsonify({**res, 'requirements': after})


@bp.get('/addons/<name>/guide')
async def get_addon_guide(name):
    """target='guide' のアドオンから番組表データを取る。?date=YYYY-MM-DD

    番組表画面が「地デジ/BS/CS」の隣に並べるソース。戻り値は
    {'channels': [{id, name, short, logo_url}], 'programs': [{ch, start_time,
    duration_sec, title, description, genre, url}]} に正規化済み。
    よそのサービスへ取りに行くため、イベントループを止めないよう別スレッドで動かす。
    """
    from logic.addons import addon_runner
    from api.routes.auth import perm
    if not perm().guide(name):
        abort(403, description='この番組表は許可されていません')
    try:
        return jsonify(await asyncio.to_thread(
            addon_runner.run_guide, name, request.args.get('date')))
    except ValueError as e:
        abort(404, description=str(e))          # アドオンが無い/無効
    except Exception as e:
        current_app.logger.warning('番組表アドオン %s が失敗: %s', name, e)
        abort(502, description=str(e))          # 取得そのものの失敗


@bp.get('/addons/settings')
def list_addon_settings():
    """設定画面用: 全アドオンのスキーマと保存済み設定を返す。

    有効/無効はどのアドオンでも切り替えたいので target で絞らない。
    設定項目(パラメータ)を持つのは 'event'/'settings_tab' と settings_params 持ちのみ。"""
    from logic.addons import addon_runner, addon_events  # noqa: F401
    from logic.addons import addon_settings
    out = []
    for schema in addon_runner.list_addons():
        out.append({**schema, 'settings': addon_settings.load_settings(
            schema['name'], addon_settings.default_enabled(schema.get('target') or 'video'))})
    return jsonify(out)


@bp.patch('/addons/<name>/settings')
async def patch_addon_settings(name):
    """アドオン設定を server/data/addon/<name>.json へ保存する。body: {enabled, params}"""
    from logic.addons import addon_runner, addon_events  # noqa: F401
    from logic.addons import addon_settings
    try:
        schema = addon_runner.load_addon(name)[1]
    except ValueError as e:
        abort(404, description=str(e))
    # 設定項目が無いアドオン(videoカード用など)でも、有効/無効の保存だけは受け付ける
    fields = schema.get('settings_params') or (
        schema['params'] if schema.get('target') in ('event', 'settings_tab') else [])
    body = await _json()
    keys = {p['key'] for p in fields}
    params = {k: v for k, v in (body.get('params') or {}).items() if k in keys}
    return jsonify(addon_settings.save_settings(name, bool(body.get('enabled')), params))


@bp.post('/addons/<name>/fire')
async def fire_addon(name):
    """設定画面からの手動実行(通知アドオンの疎通確認用)。body: {event?, payload?}"""
    from logic.addons import addon_runner, addon_events
    from logic.addons import addon_settings
    try:
        mod, schema, _ = addon_runner.load_addon(name)
    except ValueError as e:
        abort(404, description=str(e))
    if schema.get('target') not in ('event', 'settings_tab'):
        abort(400, description='手動実行できるのは target=event / settings_tab のアドオンだけです')
    body = await _json()
    conf = addon_settings.load_settings(name)
    params = {p['key']: p.get('default') for p in schema['params']}
    params.update(conf['params'])
    event = body.get('event') or (schema['events'][0] if schema['events'] else 'test')
    ctx = addon_events.EventAddonContext(name, event, body.get('payload') or {'test': True})
    # 呼んだこと自体を必ず残す(アドオンが ctx.log() で出す詳細ログとは別)
    try:
        result = mod.run(ctx, params)
    except Exception as e:
        current_app.logger.warning('アドオン %s (%s・手動実行) が失敗: %s', name, event, e)
        return jsonify({'ok': False, 'error': str(e)}), 200
    current_app.logger.info('アドオン %s (%s・手動実行) を実行: %s',
                            name, event, addon_events._brief(result))
    return jsonify({'ok': True, 'result': result if isinstance(result, (str, dict)) else str(result)})


@bp.get('/addons/jobs')
def list_addon_jobs():
    """走っている/順番待ちのアドオンジョブ。エンコードキュー画面に並べるため。

    レーンに積んだ変換（動画の形式を変えるアドオンなど）は録画のエンコードキューには並ばない
    ので、エンコードの終わりを待っていても画面から分からなかった。
    """
    from logic.addons import addon_runner
    return jsonify(addon_runner.list_jobs())


@bp.get('/addons/jobs/<job_id>')
def get_addon_job(job_id):
    """アドオン実行ジョブの状態(ポーリング用)。"""
    from logic.addons import addon_runner
    job = addon_runner.get_job(job_id)
    if job is None:
        abort(404, description='ジョブが見つかりません')
    return jsonify(job)
