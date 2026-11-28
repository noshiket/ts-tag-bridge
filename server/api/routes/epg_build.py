"""番組表の組み立て（局ごとの番組と tsid の対応）"""

import time
from datetime import datetime, timedelta
from api import schemas
from .edcb_call import _epg_svc_cache, _epg_svc_cache_lock


def _build_tsid_map(items):
    """service_type=1 の地デジ/BS サービスを (onid, tsid) → [sid, ...] にまとめる。
    EPG マルチ編成マージ用。このマップは get_services() 呼び出し時にキャッシュされる。"""
    mapping = {}
    for s in items:
        if s.get('service_type') != 1:
            continue
        onid = s.get('onid', 0)
        if not ((32736 <= onid <= 32742) or onid == 4):
            continue
        mapping.setdefault((onid, s.get('tsid')), []).append(s['sid'])
    return mapping


def _build_epg_for_service(client, onid, tsid, sid, basic=0, onair=None, tsid_map=None,
                           write_cache=True) -> list:
    """1サービス分の番組表を構築して返す（同一TSID内の全SIDをギャップ補完マージ）。

    write_cache=True かつ onair is None のとき結果を _epg_svc_cache((service,basic)) に保存する。
    tsid_map 省略時は client.enum_service から構築（起動時ウォームアップは事前構築マップを渡すこと）。
    EDCB エラーはそのまま送出する（呼び出し側で abort / ログ分岐）。_call(abort) は使わない
    （ウォームアップはリクエストコンテキスト外のため）。
    """
    if tsid_map is None:
        tsid_map = _build_tsid_map(client.enum_service())
    target_sids = tsid_map.get((onid, tsid), [sid])

    def _event_interval(e):
        try:
            start = datetime.fromisoformat(e.get('startTime', ''))
            end = start + timedelta(seconds=max(0, e.get('durationSecond', 0)))
            return start, end
        except (ValueError, TypeError):
            return None, None

    def _has_title(e):
        return bool((e.get('shortInfo') or {}).get('event_name', '').strip())

    primary_sid = target_sids[0] if target_sids else sid
    primary = [e for e in client.enum_event_info(f'{onid}-{tsid}-{primary_sid}',
                                                 basic=basic, onair=onair, count=9999)
               if _has_title(e)]

    p_intervals = [(s, e) for s, e in (_event_interval(ev) for ev in primary) if s is not None]

    extra = []
    for s_sid in target_sids[1:]:
        try:
            sub_events = client.enum_event_info(f'{onid}-{tsid}-{s_sid}',
                                                basic=basic, onair=onair, count=9999)
        except Exception:
            continue
        for e in sub_events:
            if not _has_title(e):
                continue
            es, ee = _event_interval(e)
            if es is None:
                continue
            if not any(ps < ee and pe > es for ps, pe in p_intervals):
                extra.append(e)

    all_items = primary + extra
    all_items.sort(key=lambda e: e.get('startTime', ''))
    client._load_service_map()
    result = [
        schemas.event_to_response(e, client._service_map.get((e['onid'], e['tsid'], e['sid']), ''))
        for e in all_items
    ]
    if write_cache and onair is None:
        with _epg_svc_cache_lock:
            _epg_svc_cache[(f'{onid}-{tsid}-{sid}', basic)] = (time.time(), result)
    return result
