"""表示言語（/api/i18n/*）。言語は target='language' のアドオンが足す。

アプリの文字は日本語を元に「キー → 文」の辞書で引く。アドオンは run() で、その言語の辞書
（{キー: 文 または {'one': 文, 'other': 文}}）を返す。訳の無いキーはアプリが日本語で出す。
"""

import asyncio

from quart import abort, jsonify

from api.routes.auth import bp


def _languages():
    from logic.addons import addon_runner
    return [a for a in addon_runner.list_addons(target='language', only_enabled=True)
            if not a.get('error') and a.get('lang')]


def _clean(messages) -> dict:
    """辞書の形を確かめる（文字の値と、one / other を持つ dict だけを残す）"""
    out = {}
    if not isinstance(messages, dict):
        return out
    for k, v in messages.items():
        if isinstance(v, str):
            out[str(k)] = v
        elif isinstance(v, dict) and isinstance(v.get('other'), str):
            out[str(k)] = {f: v[f] for f in ('one', 'other') if isinstance(v.get(f), str)}
    return out


@bp.get('/i18n/languages')
def list_languages():
    """選べる表示言語（日本語は本体が持つので含めない）。[{code, label, description, name}]"""
    return jsonify([{'code': a['lang'], 'label': a['label'], 'description': a['description'], 'name': a['name']}
                    for a in _languages()])


@bp.get('/i18n/<code>')
async def get_messages(code):
    """その言語の辞書。{code, label, messages}"""
    from logic.addons import addon_runner
    hit = next((a for a in _languages() if a['lang'] == code), None)
    if hit is None:
        abort(404, description=f'言語 {code} はありません')
    mod, schema, _ = addon_runner.load_addon(hit['name'], target='language')
    try:
        messages = await asyncio.to_thread(mod.run, None, {})
    except Exception as e:
        abort(502, description=f'{schema["label"]} の辞書を読めませんでした: {e}')
    return jsonify({'code': code, 'label': schema['label'], 'messages': _clean(messages)})
