"""連携先とのパターンの同期（新しい連携先の自動の埋め合わせ）"""

import asyncio
from typing import Optional
from logic.federation import fed_auth
from api.routes.parser import _parser, _push_all_patterns_to_peer, _store  # noqa: F401


async def _pull_all_patterns_from_peer(name: str, peer: dict, peer_sids: list, fed_token: str) -> dict:
    """ピアの全パターン(peer_sidsで示す全SID)を取り込んでローカルへ反映する。ローカルが
    完全に空の新規ノードが既存ピアへ合流した際の自動シードで使う(pattern(+pattern2)キーの
    add_analyzerで統合するため、呼び出し前にローカルへ既存データがあっても安全に統合される)。
    """
    import logging
    import requests
    logger = logging.getLogger(__name__)

    def _fetch(sid):
        url = f"{peer['url'].rstrip('/')}/api/patterns?sid={sid}"
        resp = requests.get(url, headers={'X-Fed-Token': fed_token}, timeout=(3, 10),
                             verify=peer.get('verify_tls', True))
        resp.raise_for_status()
        return resp.json()

    ok_count = 0
    try:
        for sid in peer_sids:
            analyzers = await asyncio.to_thread(_fetch, sid)
            p = _parser(sid, create=True)
            for a in analyzers:
                a = {k: v for k, v in a.items() if k != 'index'}  # index はサーバーが付与する表示用の値
                p.add_analyzer(a)
            p.save()
            ok_count += 1
        return {'ok': True, 'sids': ok_count}
    except Exception as e:
        logger.warning('pull_all_patterns: peer=%s failed at sid #%d/%d: %s', name, ok_count, len(peer_sids), e)
        return {'ok': False, 'sids': ok_count, 'error': str(e)}


async def _auto_seed_new_peers(cfg: dict, peer_names: Optional[list] = None) -> None:
    """新しくピア関係ができた際、ローカル/ピアのどちらか一方にパターンが全く無ければ
    自動的に埋める(既にデータがある側は上書きしない。両方に有る/両方とも無いなら何もしない)。
    fire-and-forgetで呼ばれる想定(呼び出し元をブロックしない。失敗はログのみ)。
    peer_names を指定すればそのピアのみ対象、Noneなら既知の全ピアが対象。
    """
    import logging
    import requests
    logger = logging.getLogger(__name__)
    from api.nodes.node_routes import _known_peers
    peers = _known_peers(cfg)
    if peer_names is not None:
        peers = {k: v for k, v in peers.items() if k in peer_names}
    if not peers:
        return
    local_sids = _store().list_sids()

    def _get_peer_sids(peer):
        url = f"{peer['url'].rstrip('/')}/api/patterns/sids"
        resp = requests.get(url, headers={'X-Fed-Token': fed_auth.token_for_peer(cfg, peer)}, timeout=(3, 10),
                             verify=peer.get('verify_tls', True))
        resp.raise_for_status()
        return resp.json()

    async def _one(name, peer):
        try:
            peer_sids = await asyncio.to_thread(_get_peer_sids, peer)
        except Exception as e:
            logger.warning('auto_seed_new_peers: peer=%s sids取得失敗: %s', name, e)
            return
        token = fed_auth.token_for_peer(cfg, peer)
        if local_sids and not peer_sids:
            logger.info('auto_seed_new_peers: peer=%s は空のためローカルのパターンを送信します', name)
            await _push_all_patterns_to_peer(name, peer, token)
        elif peer_sids and not local_sids:
            logger.info('auto_seed_new_peers: ローカルが空のためpeer=%sのパターンを取り込みます', name)
            await _pull_all_patterns_from_peer(name, peer, peer_sids, token)
        # 両方に既にデータがある/両方とも空 の場合は何もしない(既存データを勝手に混ぜない)

    await asyncio.gather(*(_one(name, peer) for name, peer in peers.items()))


# ---------------------------------------------------------------------------
# デバッグ API
# ---------------------------------------------------------------------------

# 直接値をセットできる列のホワイトリスト
_DEBUG_RECORDINGS_COLUMNS = {
    'state', 'error_message', 'drop_error', 'file_exist',
    'recording_start_time', 'recording_end_time',
    'title', 'folder', 'episode_number', 'episode_name', 'category',
    'eit_title', 'eit_description', 'eit_extended_info',
    'eit_start_time', 'eit_end_time', 'eit_station_name',
    'onid', 'tsid', 'sid', 'eid',
    'shimakaze_job_id', 'output_path',
    'edcb_ts_path', 'host_ts_path', 'app_ts_path',
    'amatsukaze_ts_path',
}
_DEBUG_PROGRAMS_COLUMNS = {
    'state', 'error_message', 'text_parser_result',
}
