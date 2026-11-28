"""パターンの一覧・追加・更新・削除と、連携先との同期"""

from quart import jsonify, current_app, request, abort
from text_parser.parser.core import TextParser
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _parser, _store
from .pattern_index import _resolve_index
from .pattern_sync import _propagate_pattern_sync
from .pattern_checks import _require_sid, _validate_analyzer  # noqa: F401


@bp.get('/patterns/actives')
def get_actives():
    """パターン編集画面のアクション一覧。

    組み込みアクションに加えて、アドオン(server/addon/ の target='parser_action')が
    追加したアクションも返す。UI はこのスキーマ駆動なので、アドオンを置けば
    そのままアクション選択肢とフォームに出る。
    """
    from text_parser import actions as parser_actions
    actives = list(TextParser.ANALYZE_ACTION_SCHEMA)
    # 文字を取ってくるアクション（アドオンの fetch_text）は pattern キーを持つので、
    # pattern より前に置く。画面は一覧の順で保存済みのアクションを見分けるため、後ろに置くと
    # 入れ子のパターンと取り違え、編集して保存した時に sid などが消える。アドオンが無効でも並べる
    try:
        at = next((i for i, a in enumerate(actives) if a['key'] in ('switch', 'pattern')), len(actives))
        actives[at:at] = parser_actions.fetch_text_defs()
    except Exception as e:
        current_app.logger.warning('fetch_text アドオンの読み込みに失敗(無視): %s', e)
    try:
        for a in parser_actions.list_actions():
            actives.append({
                'key': a['key'], 'label': a['label'], 'description': a['description'],
                'output_type': a['output_type'], 'default_field': a['default_field'],
                'params': a['params'], 'addon': a['addon'],
            })
    except Exception as e:
        current_app.logger.warning('parser_action アドオンの読み込みに失敗(無視): %s', e)
    return jsonify({
        'actives': actives,
        'output_fields': TextParser.OUTPUT_FIELDS,
    })


@bp.get('/patterns/sids')
def list_pattern_sids():
    """パターンファイルが存在する SID 一覧を返す。"""
    return jsonify(_store().list_sids())


@bp.get('/patterns')
def list_patterns():
    """?sid=<SID> のパターン一覧を返す。ファイルが存在しなければ空リストを返す。"""
    sid = _require_sid()
    p = _parser(sid, create=True)
    return jsonify([{'index': i, **a} for i, a in enumerate(p.analyzers)])


def _log_pattern_op(op: str, sid: int, pattern: str, before: int, after: int, detail=''):
    """パターン操作を件数つきでログに残す（「編集したら他のパターンが消えた」の追跡用）。
    どのパターンが消えたかは TextParser.save の差分ログに出る。"""
    import logging
    logging.getLogger(__name__).info(
        'pattern %s: sid=%s analyzers %d→%d pattern=%r %s', op, sid, before, after, pattern, detail)


@bp.post('/patterns')
async def add_pattern():
    """?sid=<SID> にパターンを追加する。ファイルが存在しなければ新規作成する。
    federationピアが設定されていれば、このパターンをピアへも同期する。"""
    sid = _require_sid()
    body = await _json()
    _validate_analyzer(body)
    p = _parser(sid, create=True)
    before = len(p.analyzers)
    action = p.add_analyzer(body)
    p.save()
    _log_pattern_op('add', sid, body.get('pattern', ''), before, len(p.analyzers), action)
    peer_sync = await _propagate_pattern_sync(sid, {'op': 'upsert', 'analyzer': body})
    return jsonify({'action': action, 'peer_sync': peer_sync}), 201


@bp.put('/patterns/<int:index>')
async def update_pattern(index):
    """?sid=<SID> の index 番目のパターンを上書き更新する。federationピアが設定されて
    いれば、更新前のpattern(+pattern2)をキーにピアの同じパターンも上書き同期する。"""
    sid = _require_sid()
    body = await _json()
    _validate_analyzer(body)
    p = _parser(sid)
    body = dict(body)
    body['pattern'] = p._normalize_brackets(body.get('pattern', ''))
    # 編集で pattern 文字列は変わらない（画面は元の pattern を送る）。番号がずれていたら探し直す
    index = _resolve_index(p, index, body['pattern'], body.get('pattern2', ''))
    old = p.analyzers[index]
    before = len(p.analyzers)
    # 優先度が変わったら優先度順の位置へ並び直す（変わらなければその場で置き換える）
    new_index = p.replace_analyzer(index, body)
    p.save()
    _log_pattern_op('update', sid, old.get('pattern', ''), before, len(p.analyzers),
                    f"index={index}→{new_index} → {body.get('pattern', '')}")
    peer_sync = await _propagate_pattern_sync(sid, {
        'op': 'upsert', 'analyzer': body,
        'replace': {'pattern': old.get('pattern', ''), 'pattern2': old.get('pattern2', '')},
    })
    return jsonify({'index': new_index, **p.analyzers[new_index], 'peer_sync': peer_sync})


@bp.delete('/patterns/<int:index>')
async def delete_pattern(index):
    """?sid=<SID> の index 番目のパターンを削除する。federationピアが設定されていれば、
    pattern(+pattern2)をキーにピアの同じパターンも削除同期する。"""
    sid = _require_sid()
    p = _parser(sid)
    # ?pattern=（と ?pattern2=）が付いていれば、番号がその物を指しているか確かめる（ずれていたら探し直す）
    expect = request.args.get('pattern')
    if expect is not None:
        index = _resolve_index(p, index, p._normalize_brackets(expect), request.args.get('pattern2'), exact_p2=True)
    if index < 0 or index >= len(p.analyzers):
        abort(404, description='パターンが見つかりません')
    before = len(p.analyzers)
    old = p.analyzers.pop(index)
    p.save()
    _log_pattern_op('delete', sid, old.get('pattern', ''), before, len(p.analyzers), f'index={index}')
    peer_sync = await _propagate_pattern_sync(sid, {
        'op': 'delete',
        'match': {'pattern': old.get('pattern', ''), 'pattern2': old.get('pattern2', '')},
    })
    return jsonify({'deleted': index, 'peer_sync': peer_sync})


@bp.post('/patterns/tidy')
async def tidy_patterns():
    """?sid=<SID> のパターンの重複をまとめ、優先度順に並び直す（TextParser.tidy_analyzers）。
    ?dry_run=1 なら書き換えず、変わる所だけ返す。並びはノードごとに持つので、ピアへは伝えない。"""
    sid = _require_sid()
    p = _parser(sid)
    dry = request.args.get('dry_run') in ('1', 'true')
    if dry:
        import copy
        from text_parser.parser.core import TextParser
        tmp = TextParser.__new__(TextParser)
        tmp.__dict__.update(p.__dict__)
        tmp.analyzers = copy.deepcopy(p.analyzers)
        rep = tmp.tidy_analyzers()
    else:
        before = len(p.analyzers)
        rep = p.tidy_analyzers()
        if rep['merged'] or rep['moved']:
            p.save()
        _log_pattern_op('tidy', sid, '', before, len(p.analyzers), f"merged={rep['merged']} moved={rep['moved']}")
    return jsonify({'dry_run': dry, 'merged': rep['merged'], 'moved': rep['moved'],
                    'before': [list(k) for k in rep['before']], 'after': [list(k) for k in rep['after']]})


