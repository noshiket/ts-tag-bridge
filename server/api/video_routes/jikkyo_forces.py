"""ニコニコ実況の勢い（30秒覚えておく）"""

import asyncio
import time
from quart import jsonify
from api.routes.auth import bp


# 番組表に出す実況勢い(コメ/分)の取得。NX-Jikkyo の全チャンネルを一括取得して 30 秒キャッシュする。
_JIKKYO_FORCES_CACHE: dict = {'data': None, 'ts': 0.0}
_JIKKYO_FORCES_TTL = 30.0


async def _fetch_nx_jikkyo_forces() -> dict:
    """NX-Jikkyo の各実況チャンネルの現在の勢い(コメ/分)を {jk_id: force} で返す（30秒キャッシュ）。"""
    now = time.monotonic()
    cached = _JIKKYO_FORCES_CACHE['data']
    if cached is not None and (now - _JIKKYO_FORCES_CACHE['ts']) < _JIKKYO_FORCES_TTL:
        return cached
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                'https://nx-jikkyo.tsukumijima.net/api/v1/channels',
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
        forces = {}
        for ch in data:
            jk = ch.get('id')  # 'jk1' 等
            # status=='ACTIVE'（放送中スレッド）の jikkyo_force が現在の勢い
            force = next((t.get('jikkyo_force') for t in ch.get('threads', [])
                          if t.get('status') == 'ACTIVE' and t.get('jikkyo_force') is not None), None)
            if jk and force is not None:
                forces[jk] = force
        _JIKKYO_FORCES_CACHE['data'] = forces
        _JIKKYO_FORCES_CACHE['ts'] = now
        return forces
    except Exception:
        # 取得失敗時は古いキャッシュがあればそれを返す（無ければ空）
        return cached if cached is not None else {}


@bp.get('/jikkyo/forces')
async def jikkyo_forces():
    """放送中番組の実況勢い(コメ/分)を {"<onid>-<sid>": force} で返す（番組表表示用）。"""
    from media.tsukujima.live_stream import LiveStream
    from media.tsukujima.jikkyo import get_jikkyo_id

    forces = await _fetch_nx_jikkyo_forces()
    if not forces:
        return jsonify({})
    channels = await asyncio.to_thread(LiveStream.getChannelList)
    result = {}
    for ch in channels:
        nid, sid = ch.get('network_id'), ch.get('service_id')
        if nid is None or sid is None:
            continue
        jk = get_jikkyo_id(nid, sid)
        if jk and jk in forces:
            result[f'{nid}-{sid}'] = forces[jk]
    return jsonify(result)
