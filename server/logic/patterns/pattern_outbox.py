"""パターンの変更を連携先へ届ける（届かなかった分は覚えて、つながったら順に送り直す）。

パターンは両方のサーバーで同じであるべきで、接続が切れても各自が同期済みのパターンで解析を続ける。
前は変更を1回送るだけで、相手が止まっている間の変更は失われ、静かにずれていった（SID1040 が片方 10 件・もう片方 27 件になっていた）。

届かなかった変更は data/pattern_outbox.json に相手ごとに並べて残す。その相手に残りがある間は、
新しい変更も後ろに並べる（先に届いて順番が入れ替わらないように）。送り直しは定期的に先頭から行い、
届かなければそこで止める。受け側の /api/patterns/sync は同じ変更を2度受けても同じ結果になる
（置き換え元が無ければ足す・消す物が無ければ何もしない）。
"""

import json
import logging
import os
import threading
import time

import requests

from data_paths import DATA_DIR
from logic.federation import fed_auth

logger = logging.getLogger(__name__)
_PATH = os.path.join(DATA_DIR, 'pattern_outbox.json')
_lock = threading.Lock()


def _load() -> dict:
    try:
        with open(_PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def _save(box: dict) -> None:
    box = {k: v for k, v in box.items() if v}
    tmp = _PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(box, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _PATH)


def _post(cfg: dict, peer: dict, sid: int, payload: dict) -> None:
    url = f"{peer['url'].rstrip('/')}/api/patterns/sync?sid={sid}"
    resp = requests.post(url, json=payload, headers={'X-Fed-Token': fed_auth.token_for_peer(cfg, peer)},
                         timeout=(3, 10), verify=peer.get('verify_tls', True))
    resp.raise_for_status()


def send(cfg: dict, name: str, peer: dict, sid: int, payload: dict) -> str:
    """1件を相手へ送る。'ok'（届いた）か 'queued: <理由>'（覚えた。後で送り直す）を返す"""
    with _lock:
        box = _load()
        if not box.get(name):
            try:
                _post(cfg, peer, sid, payload)
                return 'ok'
            except Exception as e:
                reason = str(e)
        else:
            reason = f'先に届いていない変更が {len(box[name])} 件ある'
        box.setdefault(name, []).append({'sid': sid, 'payload': payload, 'at': time.time()})
        _save(box)
    logger.warning('pattern sync queued: peer=%s sid=%d: %s', name, sid, reason)
    return f'queued: {reason}'


def flush(cfg: dict, peers: dict) -> int:
    """残っている変更を相手ごとに先頭から送り直す。届いた件数を返す"""
    sent = 0
    with _lock:
        box = _load()
        for name, items in box.items():
            peer = peers.get(name)
            if not peer:
                continue   # 連携をやめた相手の分は残しておく（また連携したら送る）
            while items:
                try:
                    _post(cfg, peer, items[0]['sid'], items[0]['payload'])
                except Exception as e:
                    logger.info('pattern sync retry pending: peer=%s left=%d: %s', name, len(items), e)
                    break
                items.pop(0)
                sent += 1
        if sent:
            _save(box)
    if sent:
        logger.info('pattern sync: 届いていなかった変更 %d 件を送り直しました', sent)
    return sent


def pending() -> dict:
    """相手ごとの、まだ届いていない件数"""
    with _lock:
        return {k: len(v) for k, v in _load().items() if v}
