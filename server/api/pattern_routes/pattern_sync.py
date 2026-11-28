"""パターンを他のサーバーへ写す（1件・全部）"""

import asyncio
import time
from quart import jsonify, current_app, abort
from logic.federation import fed_auth
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.parser import _parser, _push_all_patterns_to_peer
from .pattern_checks import _require_sid, _validate_analyzer
from .pattern_index import _find_analyzer_index


async def _propagate_pattern_sync(sid: int, payload: dict) -> dict:
    """パターンの変更を連携先（library_peer + remote_nodes）へ並列で送る。届かなかった分は覚えて、
    つながったら順に送り直す（logic.patterns.pattern_outbox）。ローカルの保存は届いたかどうかに関わらず成功のまま。
    戻り値は相手ごとの 'ok' か 'queued: <理由>'（レスポンスの peer_sync として返すだけ）。"""
    cfg = current_app.config['ENCODE_AUTO']
    from api.nodes.node_routes import _known_peers
    from logic.patterns import pattern_clock, pattern_outbox
    # 変えた時刻を付けて覚える（切れている間に両方で同じパターンを変えたら、後に変えた方を残す）
    payload = {**payload, 'at': time.time()}
    pattern_clock.stamp(sid, pattern_clock.keys_of(payload, _parser(sid, create=True)._normalize_brackets), payload['at'])
    peers = _known_peers(cfg)
    if not peers:
        return {}

    async def _one(name, peer):
        return name, await asyncio.to_thread(pattern_outbox.send, cfg, name, peer, sid, payload)

    pairs = await asyncio.gather(*(_one(name, peer) for name, peer in peers.items()))
    return dict(pairs)


@bp.post('/patterns/sync')
async def sync_pattern():
    """federationピアからのパターン同期を受け取る(X-Fed-Token経由、_FED_ALLOWEDで許可)。
    indexではなくpattern(+pattern2)をキーに操作する。このエンドポイント自体はさらに
    他ピアへ伝播しない(ループを構造的に防ぐ、常に伝播元=このリクエストで完結させる)。
    """
    sid = _require_sid()
    body = await _json()
    op = body.get('op')
    p = _parser(sid, create=True)
    # 後勝ち: このサーバーでそのパターンを、送られた変更より後に変えていたら当てない
    from logic.patterns import pattern_clock
    at = body.get('at')
    keys = pattern_clock.keys_of(body, p._normalize_brackets)
    if isinstance(at, (int, float)):
        if pattern_clock.is_stale(sid, keys, at):
            return jsonify({'action': 'stale'})
        pattern_clock.stamp(sid, keys, at)

    if op == 'upsert':
        analyzer = body.get('analyzer')
        if not isinstance(analyzer, dict):
            abort(400, description='analyzer フィールドが必要です')
        _validate_analyzer(analyzer)
        replace = body.get('replace')
        if replace:
            idx = _find_analyzer_index(p, replace.get('pattern', ''), replace.get('pattern2', ''))
            if idx is not None:
                analyzer = dict(analyzer)
                analyzer['pattern'] = p._normalize_brackets(analyzer.get('pattern', ''))
                idx = p.replace_analyzer(idx, analyzer)
                p.save()
                return jsonify({'action': 'replaced', 'index': idx})
        action = p.add_analyzer(analyzer)
        p.save()
        return jsonify({'action': action})

    if op == 'delete':
        match = body.get('match') or {}
        idx = _find_analyzer_index(p, match.get('pattern', ''), match.get('pattern2', ''))
        if idx is None:
            return jsonify({'action': 'noop', 'deleted': False})
        p.analyzers.pop(idx)
        p.save()
        return jsonify({'action': 'deleted', 'deleted': True})

    if op == 'bulk_upsert':
        analyzers = body.get('analyzers')
        if not isinstance(analyzers, list):
            abort(400, description='analyzers フィールド（配列）が必要です')
        results = []
        for a in analyzers:
            try:
                _validate_analyzer(a)
                results.append(p.add_analyzer(a))
            except Exception:
                results.append('error')
        p.save()
        return jsonify({'action': 'bulk_upsert', 'results': results})

    abort(400, description=f'不明な op: {op}')


@bp.post('/patterns/sync_all')
async def sync_all_patterns():
    """ローカルの全パターン(全SID)を、federationピア全員へ一括同期する(手動実行用。
    通常は新規ピア追加時に自動シード(_auto_seed_new_peers)が働くため、双方に既存データが
    ある状態を強制的に揃え直したい場合などに使う)。
    """
    cfg = current_app.config['ENCODE_AUTO']
    from api.nodes.node_routes import _known_peers
    peers = _known_peers(cfg)
    if not peers:
        abort(400, description='federationピアが設定されていません')
    async def _one_peer(name, peer):
        return name, await _push_all_patterns_to_peer(name, peer, fed_auth.token_for_peer(cfg, peer))

    pairs = await asyncio.gather(*(_one_peer(name, peer) for name, peer in peers.items()))
    return jsonify(dict(pairs))
