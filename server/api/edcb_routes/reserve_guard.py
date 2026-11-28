"""予約を足す・変える時の、利用者ごとの権限の確かめ（局と、有料の番組）。

一覧は局で絞っていたが、予約を足す口は確かめておらず、許可されていない局や有料の番組も予約できた。
- 番組表からの予約: 局と、その番組が有料か（EDCB の番組情報の freeCAFlag）
- 時刻を決めた予約・プログラム予約: 局と、その時刻の番組（分からなければ局の大半）が有料か
- キーワード自動予約: 局は許可された局だけに絞り、有料の番組を見られない人は「無料のみ」に固定する
"""

from datetime import datetime

from quart import abort

from api.routes.auth import perm


def _service(s: str):
    """'ONID-TSID-SID(-EID)' を数に（読めなければ 400）"""
    try:
        parts = [int(x) for x in str(s).split('-')]
    except ValueError:
        abort(400, description=f'局の形式が不正です: {s}')
    if len(parts) < 3:
        abort(400, description=f'局の形式が不正です: {s}')
    return parts


def _event_paid(client, key: str):
    """番組情報の有料（freeCAFlag）。引けなければ None（局の大半で決める）"""
    try:
        ev = client.enum_event_info(key, basic=1, count=1)
    except Exception:
        return None
    if ev and 'freeCAFlag' in ev[0]:
        return bool(ev[0]['freeCAFlag'])
    return None


def check_reserve(client, kind: str, kwargs: dict) -> None:
    """POST /api/reserves の前に。許可されていなければ 403"""
    p = perm()
    if p.is_admin:
        return
    if kind == 'epg':
        onid, tsid, sid, *rest = _service(kwargs.get('id'))
        paid = _event_paid(client, kwargs['id']) if not p.paid and rest else None
    else:
        onid, tsid, sid = _service(kwargs.get('service'))[:3]
        paid = None
        if not p.paid:
            try:
                start = datetime.strptime(f"{kwargs.get('startdate')} {kwargs.get('starttime')}", '%Y-%m-%d %H:%M:%S')
                paid = _event_paid(client, f'{onid}-{tsid}-{sid}-{int(start.timestamp())}')
            except ValueError:
                paid = None
    _deny_unless(p, paid, onid, tsid, sid)


def check_manu_add(params: dict) -> None:
    """POST/PATCH /api/manu_add の前に（曜日ごとの予約なので番組は決まらない。有料は局の大半で決める）"""
    p = perm()
    if p.is_admin:
        return
    onid, tsid, sid = _service(params.get('service_id'))[:3]
    _deny_unless(p, None, onid, tsid, sid)


def restrict_auto_add(params: dict) -> dict:
    """キーワード自動予約の条件を、利用者の権限に合わせて絞る"""
    p = perm()
    if p.is_admin:
        return params
    params = dict(params)
    services = [s for s in (params.get('serviceList') or []) if p.station_key(s)]
    if not services:
        abort(403, description='許可された局がありません')
    params['serviceList'] = services
    if not p.paid:
        params['freeCAFlag'] = 1          # 無料の番組のみ
    return params


def _deny_unless(p, paid, onid, tsid, sid) -> None:
    if not p.station(onid, tsid, sid):
        abort(403, description='この放送局は許可されていません')
    if not p.program(paid, onid, tsid, sid):
        abort(403, description='有料の番組は予約できません')
