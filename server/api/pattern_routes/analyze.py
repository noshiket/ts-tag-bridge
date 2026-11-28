"""パターンの試し（照合・解析・プレビュー・正規化・パス）"""

import asyncio
import re
from quart import jsonify, current_app, abort
from api import schemas
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _parser  # noqa: F401


@bp.post('/patterns/check')
async def check_pattern():
    """context.sid のパターンファイルで、context.title に最優先でマッチするパターンを確認する。

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
    matches = _parser(sid).check_matching_patterns(text, context)
    if not matches:
        return jsonify({'matched': False})
    first = matches[0]
    return jsonify({
        'matched': True,
        'result': first,
        'all_matches': [
            {'analyzer_index': m['analyzer_index'], 'pattern': m['pattern']}
            for m in matches
        ],
    })


@bp.post('/patterns/test_analyze')
async def test_analyze_actions():
    """analyze 配列をコンテキストに対して実行し結果を返す（API呼び出し含む）。

    リクエストボディ:
        {
            "analyze":  [...],               # actionsToAnalyze() の出力
            "groups":   {"g1": "...", ...},  # パターンマッチグループ
            "context":  {"title": "...", "sid": 1234, "start_time": "...", ...}
        }
    """
    body = await _json()
    analyze = body.get('analyze', [])
    context = dict(body.get('context', {}))
    sid = context.get('sid')
    if not sid:
        abort(400, description='context.sid が必要です')
    cfg = current_app.config['ENCODE_AUTO']
    for k, v in cfg.get('text_parser_context', {}).items():
        context.setdefault(k, v)
    parser = _parser(int(sid), create=True)

    # parse_text と同じ前処理: context.title の [] を setting に抽出し、title からは [] を除去
    # して context.setting へ入れる。これで単一パターンのテストでも録画詳細の再解析
    # (parse_text 経由)と同様に {$setting} が解決され、結果が一致する。
    _setting = ''
    if context.get('title'):
        _setting = ''.join(re.findall(r'\[[^\]]*\]', str(context['title'])))
        context['title'] = parser._normalize_brackets(str(context['title']))
        context['setting'] = _setting

    pattern = body.get('pattern', '')
    text = body.get('text', '')
    if pattern and text:
        # サーバー側でパターンマッチ（_build_regex_pattern で [字] 等を正規化済み）
        try:
            regex_str, group_mappings = parser._build_regex_pattern(pattern, {'analyze': analyze})
            norm_text = parser._normalize_brackets(text)
            m = re.match(regex_str, norm_text)
            if not m:
                return jsonify({'error': 'パターンがテキストにマッチしません'}), 400
            groups = {gname: m.group(i + 1) for i, gname in enumerate(group_mappings)}
        except Exception as e:
            return jsonify({'error': str(e)}), 400
    else:
        groups = body.get('groups', {})

    # pattern2 / text2 (AND条件) [実験的機能]
    pattern2 = body.get('pattern2', '')
    text2_field = body.get('text2', '')
    if pattern2 and text2_field:
        text2_val = context.get(text2_field.lstrip('$'), '')
        if not text2_val:
            return jsonify({'error': f'text2変数 {text2_field} が context にありません'}), 400
        try:
            regex_str2, group_mappings2 = parser._build_regex_pattern(pattern2, {'analyze': analyze})
            norm_text2 = parser._normalize_brackets(text2_val)
            m2 = re.search(regex_str2, norm_text2)
            if not m2:
                return jsonify({'error': f'pattern2 が {text2_field} にマッチしません'}), 400
            # pattern2 のグループはユーザーが書いた番号(g7,g3 ...)へ入れる。
            # 位置で g{offset+i} へ振り直すと非連番(例 {$7} ep{$8} {$3})でズレ、
            # pattern 側の同番号(この例だと {$6})まで潰す。実解析(text_parser の
            # _try_parse)は番号で入れているので、テストだけ結果が違っていた
            for i, gname in enumerate(group_mappings2, start=1):
                groups[gname] = m2.group(i)
        except Exception as e:
            return jsonify({'error': str(e)}), 400

    _errors = []
    # analyze 実行は syoboi 等への同期HTTP(最大10秒)を含むため、to_thread で
    # ワーカースレッドに逃がす。async ハンドラ内で直接呼ぶとイベントループが塞がり、
    # 並行するストリーミング配信のエンコーダ読み取りが飢餓して停止する
    result = await asyncio.to_thread(
        parser._process_analyze_list, analyze, groups, context, True, _errors) or {}
    # parse_text と同様、title 由来の setting を結果へ反映(analyze が明示設定していなければ)
    if _setting and not result.get('setting'):
        result['setting'] = _setting
    if _errors:
        result['parser_error'] = _errors
    return jsonify({'result': result})


