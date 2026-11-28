"""パターン画面の道具（文字の正規化・出力パスの解決・パターンの検索）"""

from quart import jsonify, current_app, abort
from api import schemas
from text_parser.parser.core import TextParser
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.parser import _parser


@bp.post('/patterns/normalize')
async def normalize_texts():
    """テキストを text_parser の正規化ルール（[字] 等の除去）に通して返す。

    リクエストボディ:
        {"texts": {"title": "ねこまる[字]", "description": "...", "extended_info": "..."}}

    レスポンス:
        {"texts": {"title": "ねこまる", "description": "...", "extended_info": "..."}}
    """
    body = await _json()
    texts = body.get('texts', {})
    if not isinstance(texts, dict):
        abort(400, description='texts must be an object')
    from text_parser.parser.core import TextParser
    normalized = TextParser._normalize_context(texts)
    if 'title' in normalized:
        normalized['title'] = TextParser._normalize_brackets(normalized['title'])
    return jsonify({'texts': normalized})


@bp.post('/patterns/resolve_path')
async def resolve_path_template():
    """app_output_path_format + フィールド値からパスを解決する。

    リクエストボディ:
        {"template": "/media/{$folder}/{$title}_{$episode_number}.mp4",
         "fields": {"title": "ねこまる", "folder": "ねこまる", "episode_number": "01"}}

    レスポンス:
        {"path": "/media/ねこまる/ねこまる_01.mp4"}
    """
    body = await _json()
    template = body.get('template', '')
    fields = body.get('fields', {})
    if not isinstance(template, str) or not template:
        abort(400, description='template が必要です')
    if not isinstance(fields, dict):
        abort(400, description='fields はオブジェクトである必要があります')
    # _resolve_set_path は self を参照しないため None で呼び出し可
    path = TextParser._resolve_set_path(None, template, fields)
    return jsonify({'path': path})


@bp.post('/patterns/search')
async def search_patterns():
    """context.sid のパターンファイルで、context.title にマッチ可能なパターンを全件検索する。

    リクエストボディ:
        {"context": {"title": "...", "start_time": "...", "extended_info": "...",
                     "description": "...", "sid": 1024}}
    """
    body = await _json()
    try:
        text, context, sid = schemas.parse_pattern_context(body)
    except ValueError as e:
        abort(400, description=str(e))
    cfg_ctx = current_app.config['ENCODE_AUTO'].get('text_parser_context', {})
    context = {**cfg_ctx, **context}
    results = _parser(sid).find_patterns_by_string(text, context)
    return jsonify({'results': results})
