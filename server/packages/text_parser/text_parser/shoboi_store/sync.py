"""番組表の取り直し（差分・6時間ごと）"""

import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Optional
from .. import shoboi_api
from .store import (  # noqa: F401
    _CHUNK_DAYS,
    _CURSOR_MARGIN,
    _FULL_AFTER,
    _FUTURE_DAYS,
    _KEEP_DAYS,
    _MAX_ITEMS,
    _PAST_DAYS,
    _RETRY_AFTER_FAIL,
    _SYNC_INTERVAL,
    _TITLE_CHUNK,
    _TS,
    _conn,
    _lock,
    _set_state,
    _state,
    save_prog_items,
    save_title_items,
    save_title_names,
)


# ── まとめ取りと差分の取り直し ────────────────────────────────────────

def _rng(a: datetime, b: datetime) -> str:
    return f"{a:%Y%m%d_%H%M%S}-{b:%Y%m%d_%H%M%S}"


def _lookup(finder, params) -> list:
    resp = finder.session.get(f"{finder.BASE_URL}/db.php", params=params, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    code = root.findtext('.//Result/Code') or root.findtext('Result/Code')
    if code and code not in ('200', '404'):
        raise RuntimeError(f"db.php {params.get('Command')}: Result/Code={code} "
                           f"{root.findtext('.//Result/Message') or ''}")
    return root


def _fetch_progs(finder, chids, a: datetime, b: datetime, since: Optional[datetime]) -> int:
    params = {'Command': 'ProgLookup', 'ChID': chids, 'Range': _rng(a, b), 'JOIN': 'SubTitles'}
    if since:
        params['LastUpdate'] = f"{since:%Y%m%d_%H%M%S}-"
    items = _lookup(finder, params).findall('.//ProgItem')
    if len(items) >= _MAX_ITEMS and b - a > timedelta(hours=2):
        # 上限で切れている。半分ずつ取り直す
        mid = a + (b - a) / 2
        return _fetch_progs(finder, chids, a, mid, since) + _fetch_progs(finder, chids, mid, b, since)
    save_prog_items(items)
    return len(items)


def _chunks(a: datetime, b: datetime):
    while a < b:
        n = min(b, a + timedelta(days=_CHUNK_DAYS))
        yield a, n
        a = n


def sync(now: float = None) -> dict:
    """番組表と作品情報を取り直す。送った問い合わせはすべて自動の枠(background)で数える。"""
    now = now if now is not None else time.time()
    finder = shoboi_api.CompleteProgramFinder()
    chid_list = sorted({str(v) for v in finder.SID_TO_CHID.values()}, key=int)
    chids = ','.join(chid_list)
    with _lock:
        c = _conn()
        try:
            st = _state(c)
        finally:
            c.close()
    start_dt = datetime.fromtimestamp(now) - timedelta(days=_PAST_DAYS)
    end_dt = datetime.fromtimestamp(now) + timedelta(days=_FUTURE_DAYS)
    cursor = datetime.fromtimestamp(now - _CURSOR_MARGIN)
    full = (not st.get('to') or now - st.get('synced_at', 0) > _FULL_AFTER
            or st.get('chids') != chid_list)
    keep_dt = datetime.fromtimestamp(now) - timedelta(days=_KEEP_DAYS)
    # 持っている範囲の始まり。全部取り直した時は _PAST_DAYS 日前から、その後は差分で確かめ
    # 続けながら _KEEP_DAYS 日まで広がる
    from_dt = start_dt if full else max(datetime.strptime(st['from'], _TS), keep_dt)
    out = {'full': full, 'progs': 0, 'titles': 0}

    with shoboi_api.background():
        if full:
            for a, b in _chunks(start_dt, end_dt):
                out['progs'] += _fetch_progs(finder, chids, a, b, None)
        else:
            prev_to = max(datetime.strptime(st['to'], _TS), from_dt)
            since = datetime.fromtimestamp(st['prog_cursor'])
            if prev_to > from_dt:
                out['progs'] += _fetch_progs(finder, chids, from_dt, prev_to, since)
            for a, b in _chunks(prev_to, end_dt):
                out['progs'] += _fetch_progs(finder, chids, a, b, None)
        with _lock:
            c = _conn()
            try:
                # 番組表はここで使えるようにする（作品情報が途中で止まっても番組表は新しい）
                _set_state(c, synced_at=now, prog_cursor=cursor.timestamp(), chids=chid_list,
                           **{'from': from_dt.strftime(_TS), 'to': end_dt.strftime(_TS)})
                c.execute("DELETE FROM store_progs WHERE st_time < ?", (keep_dt.strftime(_TS),))
                c.commit()
                in_window = {r[0] for r in c.execute(
                    "SELECT DISTINCT tid FROM store_progs WHERE st_time >= ? AND tid != ''",
                    (start_dt.strftime(_TS),))}
                known = {r[0] for r in c.execute("SELECT tid FROM store_titles")}
            finally:
                c.close()

        changed = set()
        title_cursor = st.get('title_cursor')
        names_cursor = st.get('names_cursor')
        # 変わった作品（と全作品の名前）。名前をまだ持っていなければ全期間を取る
        since = datetime.fromtimestamp(names_cursor) if names_cursor else datetime(2000, 1, 1)
        items = _lookup(finder, {'Command': 'TitleLookup', 'TID': '*', 'Fields': 'TID,Title,LastUpdate',
                                 'LastUpdate': f"{since:%Y%m%d_%H%M%S}-"}).findall('.//TitleItem')
        save_title_names(items)
        if title_cursor and known:
            tc = datetime.fromtimestamp(title_cursor).strftime(_TS)
            changed = {it.findtext('TID', '') for it in items if it.findtext('LastUpdate', '') >= tc} & known
        need = sorted((in_window - known) | changed, key=lambda t: int(t) if t.isdigit() else 0)
        for i in range(0, len(need), _TITLE_CHUNK):
            items = _lookup(finder, {'Command': 'TitleLookup',
                                     'TID': ','.join(need[i:i + _TITLE_CHUNK])}).findall('.//TitleItem')
            save_title_items(items, finder, now)
            out['titles'] += len(items)
        with _lock:
            c = _conn()
            try:
                if title_cursor:
                    # 変わった作品は取り直したので、残りも今の時点で確かめたことになる
                    c.execute("UPDATE store_titles SET checked_at = ?", (now,))
                _set_state(c, title_cursor=cursor.timestamp(), names_cursor=cursor.timestamp())
                c.commit()
            finally:
                c.close()
    return out


_sync_lock = threading.Lock()
_last_try = 0.0


def sync_pending() -> bool:
    """番組表の取り直しが必要で、次の機会に試すところか。

    取り直せば多くの解析が問い合わせなしで済むので、その間は規制で後回しにした分の
    解析し直しを待たせる（先に枠を使い切って取り直しが進まなくなるのを防ぐ）。
    取り直しに失敗した後の1時間は待たせない。
    """
    if time.time() - _last_try < _RETRY_AFTER_FAIL:
        return False
    with shoboi_api.background():
        if shoboi_api.rate_limit_remaining() > 0:
            return False     # 規制中は取り直せないので待たせない
    return time.time() - synced_at() >= _SYNC_INTERVAL


def synced_at() -> float:
    """最後に番組表を取り直した時刻（無ければ 0）。"""
    try:
        with _lock:
            c = _conn()
            try:
                return _state(c).get('synced_at', 0)
            finally:
                c.close()
    except Exception:
        return 0


def sync_if_due() -> Optional[dict]:
    """前の同期から _SYNC_INTERVAL 経っていれば同期する。同期しなければ None。"""
    global _last_try
    if not _sync_lock.acquire(blocking=False):
        return None
    try:
        now = time.time()
        if now - _last_try < _RETRY_AFTER_FAIL:
            return None
        with _lock:
            c = _conn()
            try:
                synced_at = _state(c).get('synced_at', 0)
            finally:
                c.close()
        if now - synced_at < _SYNC_INTERVAL:
            return None
        with shoboi_api.background():
            if shoboi_api.rate_limit_remaining() > 0:
                return None
        _last_try = now
        try:
            out = sync(now)
        except shoboi_api.SyobocalRateLimitError as e:
            print(f"[shoboi store] 規制・上限で番組表の取り直しを中断しました: {e}", flush=True)
            return None
        except Exception as e:
            print(f"[shoboi store] 番組表の取り直しに失敗: {e}", flush=True)
            return None
        print(f"[shoboi store] 番組表を取り直しました（{'全部' if out['full'] else '差分'}・"
              f"番組 {out['progs']}件・作品 {out['titles']}件）", flush=True)
        return out
    finally:
        _sync_lock.release()
