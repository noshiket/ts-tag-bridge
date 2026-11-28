"""アドオンの予行検索（パターン編集で、文字を取ってくるアクションの候補を見る）。

search(text, sid) を持つアドオンだけ。コアはアドオンの名前を知らず、画面がアクションの定義
（/api/patterns/actives の addon・searchable）を見て呼ぶ。
"""

from quart import abort, jsonify, request
from api.routes.auth import bp


@bp.get('/addons/<name>/search')
def search_with_addon(name):
    """?text= で探す。?sid= を渡すと放送局で絞る（アドオン次第）。"""
    text = request.args.get('text', '').strip()
    if not text:
        abort(400, description='text パラメータが必要です')
    sid_raw = request.args.get('sid', '').strip()
    try:
        sid = int(sid_raw) if sid_raw else None
    except ValueError:
        sid = None
    from logic.addons import addon_events, addon_runner  # noqa: F401
    from logic.addons import addon_settings
    try:
        mod, schema, _spdir = addon_runner.load_addon(name)
    except ValueError as e:
        abort(404, description=str(e))
    if not callable(getattr(mod, 'search', None)):
        abort(404, description=f'アドオン {name} は検索できません')
    if not addon_settings.load_settings(name, addon_settings.default_enabled(schema['target']))['enabled']:
        abort(503, description=f'アドオン {name} が無効です')
    try:
        results = mod.search(text, sid)
    except Exception as e:
        abort(502, description=f'{schema["label"]} の検索に失敗しました: {e}')
    return jsonify(results)
