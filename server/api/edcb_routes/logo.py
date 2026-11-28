"""局ロゴと EDCB の操作（/api/logo/*, /api/edcb/*）"""

import data_paths
from quart import (
    jsonify,
    request,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.edcb_call import _call, _client  # noqa: F401
from api.routes.caches import _clear_epg_caches  # noqa: F401
from .epg import (  # noqa: F401
    _logo_cache,
)


@bp.post('/logo/cache/clear')
def clear_logo_cache():
    """サーバー側ロゴキャッシュをクリアする。"""
    n = len(_logo_cache)
    _logo_cache.clear()
    return jsonify({'cleared': n})


@bp.get('/logo/list')
def list_logos():
    """station_logo/ のロゴ一覧。(onid,sid) ごとにサイズをまとめて返す。"""
    import pathlib, re
    logo_dir = pathlib.Path(data_paths.DATA_DIR) / 'station_logo'
    pat = re.compile(r'^(\d+)_(\d+)_(\d+)x(\d+)\.png$')
    pat_named = re.compile(r'^NID(\d+)-SID(\d+)\.png$')  # ユーザー配置のロゴパック
    by_ch: dict = {}
    if logo_dir.exists():
        for f in sorted(logo_dir.glob('*.png')):
            m = pat.match(f.name)
            if m:
                onid, sid, w, h = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
                key = (onid, sid)
                if key not in by_ch:
                    by_ch[key] = {'onid': onid, 'sid': sid, 'sizes': []}
                by_ch[key]['sizes'].append({'w': w, 'h': h})
                continue
            m = pat_named.match(f.name)
            if m:
                onid, sid = int(m.group(1)), int(m.group(2))
                by_ch.setdefault((onid, sid), {'onid': onid, 'sid': sid, 'sizes': []})
    return jsonify(list(by_ch.values()))


@bp.post('/logo/fetch_edcb')
def fetch_logos_from_edcb():
    """全サービスのロゴを EDCB から取得して station_logo/ に保存する。"""
    import pathlib, hashlib, struct
    logo_dir = pathlib.Path(data_paths.DATA_DIR) / 'station_logo'
    logo_dir.mkdir(parents=True, exist_ok=True)

    services = _call(_client().enum_service)
    tv = [s for s in services if s.get('service_type') == 1]
    seen_keys: set = set()
    targets = []
    for s in sorted(tv, key=lambda x: x.get('sid', 0)):
        key = (s['onid'], s['sid'])
        if key not in seen_keys:
            seen_keys.add(key)
            targets.append(s)

    saved, skipped, errors = [], [], []
    for s in targets:
        onid, sid = s['onid'], s['sid']
        try:
            data = _client().get_logo(onid, sid)
            if data[:3] == b'GIF' and len(data) < 64:
                skipped.append(f'{onid}_{sid}')
                continue
            if data[:8] != b'\x89PNG\r\n\x1a\n':
                skipped.append(f'{onid}_{sid}')
                continue
            w, h = struct.unpack('>II', data[16:24])
            stem = f'{onid}_{sid}_{w}x{h}'
            canon = logo_dir / f'{stem}.png'
            new_hash = hashlib.md5(data).hexdigest()
            if canon.exists() and hashlib.md5(canon.read_bytes()).hexdigest() == new_hash:
                skipped.append(stem)
            else:
                canon.write_bytes(data)
                saved.append(stem)
                _logo_cache[(onid, sid)] = data
        except Exception as e:
            errors.append(f'{onid}_{sid}: {str(e)[:80]}')

    return jsonify({'saved': saved, 'skipped': skipped, 'errors': errors})


# ---------------------------------------------------------------------------
# EDCB 制御
# ---------------------------------------------------------------------------

@bp.post('/edcb/epg_cap')
def edcb_epg_cap():
    """EDCB に今すぐ番組表を取りに行かせる（番組表の控えも消す）。"""
    result = _call(_client().epg_cap_now)
    _clear_epg_caches()
    return jsonify(result)


@bp.post('/edcb/reload_epg')
def edcb_reload_epg():
    """EDCB に番組表を読み直させる（番組表の控えも消す）。"""
    result = _call(_client().reload_epg)
    _clear_epg_caches()
    return jsonify(result)


@bp.get('/edcb/showlog')
def edcb_showlog():
    """EDCB のログ。?debug=true でデバッグの出力、?max_chars= で長さを絞る。EDCB 側で許していなければ 403。"""
    debug     = request.args.get('debug', 'false').lower() == 'true'
    max_chars = request.args.get('max_chars', type=int)
    try:
        text = _client().get_showlog(debug=debug, max_chars=max_chars)
    except PermissionError as e:
        abort(403, description=str(e))
    except Exception as e:
        abort(502, description=str(e))
    return jsonify({'log': text})
