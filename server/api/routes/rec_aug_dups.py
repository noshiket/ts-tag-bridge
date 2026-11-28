"""録画結果の重複（この・連携先のライブラリにある同じ番組）"""

import time
import threading
from quart import current_app
from logic.federation import fed_auth
from logic.recordings.segment_calculator import episode_list as _as_list


# 重複表示用: federationピア(マスター)のvideo索引キャッシュ(TTL 120秒, best-effort)。
# スレーブのvideoはエンコード後マスターへ移動されるため、ローカルvideo.dbだけでは一致しない。
_dup_peer_cache = {'ts': 0.0, 'items': []}


def _peer_video_index(cfg: dict) -> list:
    """federation送信側: マスターのvideo索引を取得する(失敗時は前回値/空。rec_aug構築を
    ネットワーク待ちで遅らせないよう短timeout+TTL内は再試行しない)。"""
    fed = (cfg.get('federation') or {})
    lp = fed.get('library_peer') or {}
    if not lp.get('url'):
        return []
    now = time.time()
    if now - _dup_peer_cache['ts'] < 120:
        return _dup_peer_cache['items']
    _dup_peer_cache['ts'] = now
    try:
        import requests as _rq
        resp = _rq.get(f"{lp['url'].rstrip('/')}/api/fed/videos_index",
                       headers={'X-Fed-Token': fed_auth.token_for_peer(cfg, lp)},
                       timeout=(2, 5), verify=lp.get('verify_tls', True))
        resp.raise_for_status()
        items = resp.json()
        if isinstance(items, list):
            peer_name = lp.get('name') or 'master'
            for it in items:
                it['origin_peer'] = peer_name
            _dup_peer_cache['items'] = items
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).warning('_peer_video_index: %s', e)
    return _dup_peer_cache['items']


# 索引本体のキャッシュ。作り直しは全video走査(実測 約2.9秒/12,734本)で、
# 録画一覧と予約一覧の両方が毎回呼ぶため支配的なコストになっていた。
# videos/series/albums の指紋(episode_index_token, 約4ms)とピア索引の取得時刻が
# 変わらない限り作り直さない。
_dup_map_cache = {'key': None, 'data': None}


_dup_map_lock = threading.Lock()


def _build_video_dup_map() -> dict:
    """既存videoの重複判定索引 (album, series, episode_number, episode_name) → [video...]。
    録画一覧(rec_aug)と予約一覧(reserves/augmented)で共用。federation送信側は
    マスター側索引(_peer_video_index)も統合する。失敗時は空dict。

    話数/話数名は NULL と '' を同じ「未設定」として持つ（登録経路によって両方入るため。
    video_db.find_registered_episodes / segment_calculator._key と揃える）。

    返す辞書と中の項目は呼び出し間で共有する。いずれもレスポンスへ入れて読むだけで
    書き換えないことを前提にしている。"""
    dup_map = {}
    try:
        try:
            vdb = current_app.config.get('VIDEO_DB')
            cfg = current_app.config.get('ENCODE_AUTO') or {}
        except RuntimeError:  # appコンテキスト外(起動時ウォームアップ)はローカル索引のみ
            from logic.encode_pipeline.base.context import _get_video_db
            vdb, cfg = _get_video_db(), {}
        peer = _peer_video_index(cfg)
        # 指紋が同じなら作り直さない。ピア索引は _peer_video_index が 120秒 TTL で
        # 持つので、その取得時刻も鍵に入れて更新へ追従する
        key = ((vdb.episode_index_token() if vdb else None), _dup_peer_cache['ts'])
        with _dup_map_lock:
            if _dup_map_cache['key'] == key and _dup_map_cache['data'] is not None:
                return _dup_map_cache['data']
        for it in (vdb.list_episode_index() if vdb else []) + peer:
            k = (str(it['album']) if it.get('album') is not None else None,
                 str(it['series']) if it.get('series') is not None else None,
                 '' if it.get('episode_number') is None else str(it['episode_number']),
                 '' if it.get('episode_name') is None else str(it['episode_name']))
            dup_map.setdefault(k, []).append(it)
        with _dup_map_lock:
            _dup_map_cache['key'] = key
            _dup_map_cache['data'] = dup_map
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).warning('dup index build failed: %s', e)
    return dup_map


def _dup_for_recording(dup_map: dict, rec: dict) -> list:
    """recordingの確定値(folder/title/episode_number/episode_name)でvideo索引を引く。"""
    from logic.recordings.segment_calculator import _at
    from logic.recordings.duplicates import _key

    def _s(v):
        return None if v is None else str(v)

    ep_nums = _as_list(rec.get('episode_number'))
    ep_names = _as_list(rec.get('episode_name'))
    folder, title = rec.get('folder'), rec.get('title')
    out, seen = [], set()
    n = max(len(ep_nums), len(ep_names), 1)
    for i in range(n):
        en = _key(ep_nums[i] if i < len(ep_nums) else None)
        nm = _key(ep_names[i] if i < len(ep_names) else None)
        if en is None and nm is None:
            continue
        k = (_s(_at(folder, i)), _s(_at(title, i)),
             '' if en is None else str(en), '' if nm is None else str(nm))
        for it in dup_map.get(k, ()):
            key = (it.get('origin_peer'), it.get('id'))
            if key not in seen:
                seen.add(key)
                out.append(it)
    return out
