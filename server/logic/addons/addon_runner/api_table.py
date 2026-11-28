"""アドオンが持つ自分の API の口（ADDON と並べて書く API 表）を読む。

    API = {
        'GET status': status,                          # ログインした人が呼べる
        'POST reload': {'fn': reload, 'auth': 'admin'},  # 管理者だけ
    }

外からは /api/addons/<名前>/api/<サブパス> で呼ぶ（api/addons/addon_api.py が中継する）。
関数は fn(req) で、req は AddonApiRequest。説明書き（docstring）は API の一覧の画面に出る。
"""

import re
from dataclasses import dataclass, field

METHODS = ('GET', 'POST', 'PATCH', 'PUT', 'DELETE')
_AUTHS = ('login', 'admin')
_SUB = re.compile(r'^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*$')


@dataclass
class AddonApiRequest:
    """アドオンの口の関数が受け取るもの"""
    addon: str          # アドオンの名前
    method: str         # GET / POST ...
    path: str           # サブパス（'status' など）
    args: dict          # クエリ文字列
    body: dict          # JSON の本文（無ければ {}）
    params: dict        # 設定画面で保存した設定（settings_params の既定値の上に重ねたもの）
    user: dict | None = field(default=None)  # 呼んだ人（id・username・is_admin）。サーバー同士の中継では None


def api_table(mod) -> dict:
    """モジュールの API 表を {(メソッド, サブパス): {'fn', 'auth'}} にそろえる。無ければ {}。
    書き間違い（メソッド・サブパス・auth・関数でない）は ValueError"""
    raw = getattr(mod, 'API', None)
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError('API は dict で書いてください')
    out = {}
    for key, spec in raw.items():
        method, _, sub = str(key).strip().partition(' ')
        method, sub = method.upper(), sub.strip().strip('/')
        if method not in METHODS or not _SUB.match(sub):
            raise ValueError(f"API の鍵 {key!r} は 'GET status' の形で書いてください")
        spec = spec if isinstance(spec, dict) else {'fn': spec}
        auth = spec.get('auth') or 'login'
        if not callable(spec.get('fn')) or auth not in _AUTHS:
            raise ValueError(f'API {key!r} は関数と auth（{" / ".join(_AUTHS)}）で書いてください')
        out[(method, sub)] = {'fn': spec['fn'], 'auth': auth}
    return out


def addon_apis():
    """置いてあるアドオンの API 表を [(名前, 表)] で返す（API の一覧の画面用）。読めないアドオンは飛ばす"""
    from .discovery import _addon_entries, _load_module
    out = []
    for name, entry, spdir in _addon_entries():
        try:
            table = api_table(_load_module(name, entry, spdir))
        except Exception:
            continue
        if table:
            out.append((name, table))
    return out
