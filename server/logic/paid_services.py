"""有料の局（番組の大半が有料＝スクランブルの局）の一覧。

無料・有料は番組ごとの情報（EDCB の番組情報の freeCAFlag、TS の EIT の free_CA_mode）。
録画・動画には取り込みの時に is_paid を残すが、それより前の物や、予約（番組情報を持たない）は
分からない。その時は「その局の番組の大半が有料か」で決める。
局ごとに番組情報を 100 件ほど引いて決め、6 時間持つ。地デジは無料なので引かない。
"""

import logging
import threading
import time

logger = logging.getLogger(__name__)

_TTL = 6 * 3600
_lock = threading.Lock()
_state = {'at': 0.0, 'paid': frozenset()}
_client_provider = None


def set_client_provider(fn) -> None:
    """EDCB の呼び出し口を返す関数（起動時に1回。テストでは置かない＝有料の局なし）"""
    global _client_provider
    _client_provider = fn


def paid_services() -> frozenset:
    """有料の局の 'ONID-TSID-SID' の集まり。引けなければ前の値（初めは空）"""
    if _client_provider is None:
        return frozenset()
    if time.time() - _state['at'] < _TTL:
        return _state['paid']
    with _lock:
        if time.time() - _state['at'] < _TTL:
            return _state['paid']
        try:
            _state['paid'] = frozenset(_compute(_client_provider()))
        except Exception as e:
            logger.warning('有料の局の一覧を作れませんでした（前の値を使う）: %s', e)
        _state['at'] = time.time()
    return _state['paid']


def _compute(client) -> set:
    paid = set()
    for s in client.enum_service():
        onid, tsid, sid = s.get('onid'), s.get('tsid'), s.get('sid')
        if s.get('service_type') != 1 or onid is None or 0x7880 <= onid <= 0x7FEF:
            continue                      # テレビ以外と地デジ（無料）は見ない
        try:
            events = client.enum_event_info(f'{onid}-{tsid}-{sid}', basic=1, count=100)
        except Exception:
            continue
        flags = [bool(e.get('freeCAFlag')) for e in events if 'freeCAFlag' in e]
        if flags and sum(flags) * 2 > len(flags):
            paid.add(f'{onid}-{tsid}-{sid}')
    logger.info('有料の局: %d 局', len(paid))
    return paid
