"""しょぼいカレンダー（/api/shoboi/*）。

api/routes.py から分けた。Blueprint(bp) と共通の補助は api.routes にある。
"""

import asyncio
from quart import jsonify, request, abort

from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _require_admin  # noqa: F401


# ---------------------------------------------------------------------------
# しょぼいカレンダー
# ---------------------------------------------------------------------------

@bp.get('/shoboi/search')
def shoboi_search():
    """タイトルキーワードでしょぼいカレンダーを検索"""
    q = request.args.get('q', '').strip()
    if not q:
        abort(400, description='q パラメータが必要です')
    from text_parser.shoboi_api import CompleteProgramFinder
    finder = CompleteProgramFinder()
    results = finder.search_title_by_keyword(q)
    return jsonify(results)


@bp.get('/shoboi/programs')
def shoboi_programs():
    """SID + 開始時刻からしょぼいカレンダーの番組リストを取得"""
    from datetime import datetime as _dt
    sid_raw = request.args.get('sid', '').strip()
    start_raw = request.args.get('start_time', '').strip()
    if not sid_raw or not start_raw:
        abort(400, description='sid と start_time パラメータが必要です')
    try:
        sid = int(sid_raw)
    except ValueError:
        abort(400, description='sid は整数です')
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M', '%Y-%m-%d %H:%M'):
        try:
            start_dt = _dt.strptime(start_raw, fmt)
            break
        except ValueError:
            continue
    else:
        abort(400, description='start_time のフォーマットが不正です (YYYY-MM-DDTHH:MM:SS)')
    from text_parser.shoboi_api import CompleteProgramFinder
    from datetime import timedelta as _td
    tolerance_min = int(request.args.get('tolerance', 30))
    finder = CompleteProgramFinder()
    result = finder.search_programs_by_eit(sid, start_dt)
    if result.get('success') and result.get('programs'):
        lo = start_dt - _td(minutes=tolerance_min)
        hi = start_dt + _td(minutes=tolerance_min)
        from datetime import datetime as _dt2
        result['programs'] = [
            p for p in result['programs']
            if p.get('start_time') and lo <= _dt2.strptime(p['start_time'], '%Y-%m-%d %H:%M:%S') <= hi
        ]
    return jsonify(result)


@bp.get('/shoboi/title')
def shoboi_title():
    """TIDから作品情報（yomi・wiki_url含む）を取得"""
    tid = request.args.get('tid', '').strip()
    if not tid:
        abort(400, description='tid パラメータが必要です')
    from text_parser.shoboi_api import CompleteProgramFinder
    finder = CompleteProgramFinder()
    info = finder.get_title_info(tid) or {}
    return jsonify(info)


@bp.get('/shoboi/wiki')
def shoboi_wiki():
    """Wikipedia URLからページ名を取得（url パラメータ優先、なければ tid から URL 取得後にタイトル取得）"""
    from text_parser.shoboi_api import CompleteProgramFinder
    finder = CompleteProgramFinder()
    url = request.args.get('url', '').strip()
    if not url:
        tid = request.args.get('tid', '').strip()
        if not tid:
            abort(400, description='url または tid パラメータが必要です')
        url = finder.get_wikipedia_url(tid)
    if not url:
        return jsonify({'wiki_title': ''})
    return jsonify({'wiki_title': finder.get_wikipedia_title(url)})


@bp.get('/shoboi/status')
def shoboi_status():
    """しょぼいカレンダーへの問い合わせの状態（接続テスト待ちか・規制の期限・送信回数）。"""
    from text_parser import shoboi_api
    return jsonify(shoboi_api.probe_status())


@bp.post('/shoboi/probe')
async def shoboi_probe():
    """接続テスト。しょぼいカレンダーへ1回だけ問い合わせ、通れば止めていた問い合わせを再開する。

    429 の後は期限が来ても自動では再開しない（shoboi_api._syoboi_needs_probe）。規制の期限前は
    送らずにそう返す（送ると規制が延びる）。
    """
    _require_admin()
    from text_parser import shoboi_api
    return jsonify(await asyncio.to_thread(shoboi_api.probe))
