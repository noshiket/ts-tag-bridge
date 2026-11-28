"""録画・エンコードを番号で開く口と、ライブ視聴の口の、利用者ごとの権限の確かめ。

一覧は局で絞っているが、番号で1件を開く口（録画詳細・再生・コマ・サムネ・解析の結果・
エンコードの詳細など）は確かめておらず、URL を直に打てば許可されていない局の録画が見えた。
口ごとに書くと足し忘れるので、まとめてここで見る（_require_auth から呼ぶ）。

- 録画の局・有料の番組が許可されていなければ 403
- 録画結果かエンコードの画面を開けなければ 403
- ライブ視聴は、ライブ視聴の画面と、その局（有料の局か）を見る
"""

import re

# (パスの形, 番号の種類)。rec は recordings.id（無ければ EDCB の録画番号でも引く）、
# edcb は EDCB の録画番号（無ければ recordings.id）、enc は encodings.id
_LIVE = re.compile(r'^/api/streams/live/([^/]+)/')

_PATTERNS = [
    (re.compile(r'^/api/recordings/augmented/(\d+)$'), 'rec'),
    (re.compile(r'^/api/encode/recordings/(\d+)(/|$)'), 'rec'),
    (re.compile(r'^/api/encode/encodings/(\d+)(/|$)'), 'enc'),
    (re.compile(r'^/api/recordings/(\d+)$'), 'edcb'),
    (re.compile(r'^/api/rules/(\d+)(/|$)'), 'rule'),
]


def rule_visible(perm, rule) -> bool:
    """このサーバーが持つ予約（programs の行）を見てよいか。局は reserve_key（ONID-TSID-SID-EID）から"""
    try:
        onid, tsid, sid = (int(x) for x in str(rule.get('reserve_key') or '').split('-')[:3])
    except ValueError:
        return perm.is_admin or (perm.all_stations and perm.paid)
    return perm.program(None, onid, tsid, sid)


def _recording_of(db, kind: str, n: int):
    if kind == 'rule':
        rule = db.get_rule(n)
        if not rule:
            return None
        parts = str(rule.get('reserve_key') or '').split('-')
        keys = dict(zip(('onid', 'tsid', 'sid'), (int(x) if x.isdigit() else None for x in parts[:3])))
        return {'is_paid': None, **keys}
    if kind == 'enc':
        enc = db.get_encoding(n)
        return db.get_recording(enc['recording_id']) if enc else None
    if kind == 'edcb':
        return db.get_recording_by_rec_id(n) or db.get_recording(n)
    return db.get_recording(n) or db.get_recording_by_rec_id(n)


def check(path: str, perm, rule_db):
    """許可されていなければ断りの文、良ければ None"""
    if perm.is_admin:
        return None
    live = _LIVE.match(path)
    if live:
        return _check_live(live.group(1), perm)
    for rx, kind in _PATTERNS:
        m = rx.match(path)
        if not m:
            continue
        if not (perm.screen('recresult') or perm.screen('encode') or (kind == 'rule' and perm.screen('reservations'))):
            return 'この画面は許可されていません'
        if (perm.all_stations and perm.paid) or rule_db is None:
            return None
        rec = _recording_of(rule_db, kind, int(m.group(1)))
        if rec is None:
            return None                      # 無い物はそれぞれの口が 404 を返す
        if not perm.program(rec.get('is_paid'), rec.get('onid'), rec.get('tsid'), rec.get('sid')):
            return 'この録画は許可されていません（局か有料の番組）'
        return None
    return None


def _check_live(channel_id: str, perm):
    if not perm.screen('live'):
        return 'ライブ視聴は許可されていません'
    from media.tsukujima.live_stream import LiveStream
    ch = LiveStream.resolve_channel(channel_id)
    if ch is None:
        return None                          # 無い局はそれぞれの口が断る
    if not perm.program(None, ch['network_id'], ch['transport_stream_id'], ch['service_id']):
        return 'この局のライブ視聴は許可されていません（局か有料の局）'
    return None
