"""番組表・サービス・検索・録画設定の選択肢"""

import time
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api import schemas
from api.routes.auth import bp, perm, require_screen  # noqa: F401
from api.routes.epg_build import _build_epg_for_service, _build_tsid_map  # noqa: F401
from api.routes.edcb_call import _call, _client, _epg_svc_cache, _epg_svc_cache_lock  # noqa: F401
from api.routes.caches import _reserve_cache, _reserve_cache_lock
from .epg_common import _cached_json, require_station


# 局ロゴキャッシュ（サーバープロセス内）
_logo_cache: dict[tuple[int, int], bytes | None] = {}  # (onid, sid) -> bytes or None(no logo)
_EPG_SVC_CACHE_TTL = 6 * 3600  # 6時間


def _crop_169(png_bytes: bytes) -> bytes:
    """正方形などのロゴ画像を中央 16:9 にトリムし、EDCB 抽出ロゴ(64x36)とアスペクト比を揃える。
    16:9 以下に横長の画像はそのまま返す。"""
    try:
        import cv2
        import numpy as np
        arr = cv2.imdecode(np.frombuffer(png_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
        if arr is None:
            return png_bytes
        h, w = arr.shape[:2]
        target_h = round(w * 9 / 16)
        if h > target_h:
            top = (h - target_h) // 2
            ok, buf = cv2.imencode('.png', arr[top:top + target_h, :])
            if ok:
                return buf.tobytes()
    except Exception:
        pass
    return png_bytes
_RESERVE_CACHE_TTL = 5.0


def _enum_reserve_cached():
    now = time.time()
    with _reserve_cache_lock:
        if _reserve_cache['data'] is not None and now - _reserve_cache['ts'] < _RESERVE_CACHE_TTL:
            return _reserve_cache['data']
    data = _call(_client().enum_reserve_info)
    with _reserve_cache_lock:
        _reserve_cache['ts'] = time.time()
        _reserve_cache['data'] = data
    return data


@bp.get('/services')
def get_services():
    """サービス（チャンネル）一覧。TV(service_type=1)のみ、同ONID+TSID+名前は最小SIDを残す"""
    items = _call(_client().enum_service)
    tv = [s for s in items if s.get('service_type') == 1]
    seen = {}
    deduped = []
    for s in sorted(tv, key=lambda x: x['sid']):
        key = (s['onid'], s['tsid'], s.get('service_name', ''))
        if key not in seen:
            seen[key] = True
            deduped.append(s)
    # マルチ編成マージ用マップをキャッシュ（EPGリクエストで再利用）
    current_app.config['_tsid_sids'] = _build_tsid_map(items)
    out = [schemas.service_to_response(s) for s in deduped]
    return _cached_json(perm().filter_items(out), per_user=True)


@bp.get('/epg')
def get_epg():
    """番組表取得。?service=ONID-TSID-SID[&start=UNIX_SEC&end=UNIX_SEC]
    start/end 省略時は現在時刻 -1h 〜 +8日 (JST) を自動設定。
    時間範囲クエリを使うため count 上限なし。
    地デジ/BS は同一TSID内の全SIDをギャップ補完マージ（マルチ編成対応）。
    """
    service = request.args.get('service')
    if not service:
        abort(400, description='service パラメータが必要です (例: 4-16400-101)')
    basic = int(request.args.get('basic', 0))   # 0=詳細情報も取得
    onair = request.args.get('onair', type=int)
    client = _client()

    try:
        onid, tsid, sid = map(int, service.split('-'))
    except ValueError:
        abort(400, description='service の形式が不正です')
    require_screen('epg')
    require_station(onid, tsid, sid)

    # onair 指定（現在番組）は時刻依存なのでキャッシュしない。グリッドの通常取得のみキャッシュ。
    use_cache = onair is None
    cache_key = (service, basic)
    result = None
    if use_cache:
        with _epg_svc_cache_lock:
            hit = _epg_svc_cache.get(cache_key)
        if hit and (time.time() - hit[0]) < _EPG_SVC_CACHE_TTL:
            result = hit[1]

    if result is None:
        # キャッシュ済みマップから同一TSIDのSIDを取得（サービス未取得ならここで構築）
        tsid_map = current_app.config.get('_tsid_sids')
        if not tsid_map:
            tsid_map = current_app.config['_tsid_sids'] = _build_tsid_map(_call(client.enum_service))

        # EDCB エラーは従来どおり 502 にする（ヘルパーは _call を使わず素のまま送出する）
        try:
            result = _build_epg_for_service(client, onid, tsid, sid, basic=basic, onair=onair,
                                            tsid_map=tsid_map, write_cache=use_cache)
        except Exception as e:
            abort(502, description=str(e))

    # 番組表グリッドは extended_info を使わない(実測で全体の73%。EDCB の basic フラグでは
    # 落ちてこない)。番組詳細を開いた時だけ /epg/event で1件取り直す。
    # キャッシュは詳細込みのまま持ち、返す時だけ落とす(局単位キャッシュを分けないため)
    if request.args.get('no_ext') == '1':
        result = [{k: v for k, v in ev.items() if k != 'extended_info'} for ev in result]
    # 有料の番組を見られない利用者には出さない（番組ごとの free_ca）
    p = perm()
    if not p.paid:
        result = [ev for ev in result if p.program(None if ev.get('free_ca') is None else not ev['free_ca'], onid, tsid, sid)]
    return _cached_json(result, per_user=True)


# ---------------------------------------------------------------------------
# 番組検索
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 予約
# ---------------------------------------------------------------------------

@bp.get('/reserves')
def list_reserves():
    """EDCB の予約の一覧（利用者の権限で見られる物だけ）。"""
    require_screen('reservations')
    items = _call(_client().enum_reserve_info)
    return jsonify(perm().filter_items([schemas.reserve_to_response(r) for r in items]))
