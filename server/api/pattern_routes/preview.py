"""パターンの試し（解析の結果を見る・当たるパターン）"""

import asyncio
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.parser import _parser


@bp.post('/patterns/preview')
async def preview_parse():
    """登録済みアナライザ全体(=録画詳細の再解析 parse_text と同一)でタイトルを解析し、
    どのアナライザが実際に採用されるか(precedence 込み)と結果を返す。

    クライアントのプレビュー(mockParse)は単一パターン・client側簡易マッチのため
    サーバの parse_text と食い違う(明示マッチ優先/NFKC正規化/全角空白等)。本エンドポイントは
    parse_text をそのまま用いるので、プレビュー結果が再解析と必ず一致する。

    body: {context:{title, sid, ...}, analyzers?:[...] }
      analyzers 省略時は SID の登録済みアナライザを使う(編集中の候補を含めたい場合は送る)。
    """
    body = await _json()
    context = dict(body.get('context', {}))
    sid = context.get('sid')
    if not sid:
        abort(400, description='context.sid が必要です')
    cfg = current_app.config['ENCODE_AUTO']
    for k, v in cfg.get('text_parser_context', {}).items():
        context.setdefault(k, v)
    # プレビューは既定でしょぼいカレンダーを叩かない(1件あたり最大10秒かかるため)。
    # 取得結果まで確認したい場合だけ body に skip_external:false を送る。
    if body.get('skip_external', True):
        context['_skip_external'] = True
    parser = _parser(int(sid), create=True)
    override = body.get('analyzers')
    title = context.get('title', '')

    def _run():
        saved = parser.analyzers
        if isinstance(override, list):
            parser.analyzers = override
        try:
            mi = []
            result = parser.parse_text(title, dict(context), _match_info=mi) or {}
            info = mi[0] if mi else None
            return result, info
        finally:
            parser.analyzers = saved

    result, info = await asyncio.to_thread(_run)
    if not result:
        return jsonify({'status': 'nomatch'})
    return jsonify({
        'status': 'matched',
        'matched_index': info['index'] if info else None,
        'matched_pattern': info['pattern'] if info else None,
        'match_pass': info['pass'] if info else None,
        'result': result,
    })


@bp.post('/patterns/matches')
async def pattern_matches():
    """パターン登録画面の「完全マッチ」用。登録済みアナライザ全体で title にマッチする
    パターンを text_parser の正規化/正規表現で判定して返す(client 簡易マッチの乖離解消)。
    アクション(API)は実行しない。body: {context:{title,sid,...}, analyzers?:[...]}"""
    body = await _json()
    context = dict(body.get('context', {}))
    sid = context.get('sid')
    if not sid:
        abort(400, description='context.sid が必要です')
    cfg = current_app.config['ENCODE_AUTO']
    for k, v in cfg.get('text_parser_context', {}).items():
        context.setdefault(k, v)
    parser = _parser(int(sid), create=True)
    override = body.get('analyzers')
    title = context.get('title', '')

    def _run():
        saved = parser.analyzers
        if isinstance(override, list):
            parser.analyzers = override
        try:
            return parser.match_report(title, context)
        finally:
            parser.analyzers = saved

    report = await asyncio.to_thread(_run)
    return jsonify(report)
