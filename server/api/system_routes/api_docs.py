"""このサーバーの API の一覧（開発者向けの説明の画面が読む。GET /api/docs/routes）。

手で書いた一覧はすぐ古くなるので、動いているサーバーの口（URL・メソッド）と、各口の関数の説明書き（docstring）から作る。
口を足せば、説明書きを書くだけで画面にも出る。
"""

import inspect
import re

from quart import current_app, jsonify

from api.routes.auth import bp
from api.routes.caches import _require_admin
from api.routes.access_rules import _ADMIN_ONLY, _FED_ALLOWED

_SKIP_METHODS = {'HEAD', 'OPTIONS'}


def _group(path: str) -> str:
    """/api/<ここ>/... で分ける（/api/nodes/<名前>/... の中継もそのまま nodes）"""
    parts = [p for p in path.split('/') if p]
    return parts[1] if len(parts) > 1 and parts[0] == 'api' else parts[0] if parts else '/'


def _sample(path: str) -> str:
    """<int:id> などを実際に来そうな値に置き換える（通り方の決まり＝正規表現に当てるため）"""
    path = re.sub(r'<int:[^>]+>', '1', path)
    path = re.sub(r'<path:[^>]+>', 'a/b', path)
    return re.sub(r'<[^>]+>', 'x', path)


def _auth(view, blueprint: str, path: str) -> str:
    """誰が呼べるか（api/routes/auth.py の _require_auth と同じ決まり）。
    public: ログイン不要 / fed: サーバー同士の合言葉 / admin: 管理者だけ / login: ログインした人"""
    if blueprint == 'fed':
        return 'fed'
    if path.startswith('/api/auth/'):
        return 'public'
    try:
        src = inspect.getsource(view)
    except (OSError, TypeError):
        src = ''
    return 'admin' if _ADMIN_ONLY.match(_sample(path)) or '_require_admin(' in src else 'login'


def _relayable(path: str, methods) -> bool:
    """他のサーバーから /api/nodes/<名前>/... で中継して呼べるか（access_rules の _FED_ALLOWED）"""
    p = _sample(path)
    return any(m in allowed and rx.match(p) for allowed, rx in _FED_ALLOWED for m in methods)


def _addon_routes() -> list:
    """アドオンが API 表で持つ口（/api/addons/<名前>/api/<サブパス>）。中継の口1本の裏にあるので url_map には出ない"""
    from logic.addons.addon_runner.api_table import addon_apis
    out = []
    for name, table in addon_apis():
        for (method, sub), route in table.items():
            doc, path = inspect.getdoc(route['fn']) or '', f'/api/addons/{name}/api/{sub}'
            out.append({
                'path': path, 'methods': [method], 'group': 'addons',
                'summary': doc.split('\n', 1)[0].strip(), 'doc': doc, 'auth': route['auth'], 'relay': _relayable(path, [method]),
                'source': f'addon.{name}.{getattr(route["fn"], "__name__", "?")}',
            })
    return out


@bp.get('/docs/routes')
def api_doc_routes():
    """このサーバーの API の一覧。URL・メソッド・説明書き（関数の docstring）・呼べる人（public / login / admin / fed）・
    他のサーバーから中継して呼べるか（relay）を返す。"""
    _require_admin()
    out = []
    for rule in current_app.url_map.iter_rules():
        path = rule.rule
        if not path.startswith('/api/'):
            continue
        view = current_app.view_functions.get(rule.endpoint)
        if view is None:
            continue
        doc = inspect.getdoc(view) or ''
        methods = sorted(m for m in (rule.methods or ()) if m not in _SKIP_METHODS)
        out.append({
            'path': path,
            'methods': methods,
            'group': _group(path),
            'summary': doc.split('\n', 1)[0].strip(),
            'doc': doc,
            'auth': _auth(view, rule.endpoint.split('.', 1)[0], path),
            'relay': _relayable(path, methods),
            'source': f'{view.__module__}.{view.__name__}',
        })
    out += _addon_routes()
    out.sort(key=lambda r: (r['group'], r['path'], r['methods']))
    return jsonify({'routes': out})
