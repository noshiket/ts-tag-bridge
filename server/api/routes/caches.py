"""EPG・予約・アルバムのキャッシュと、EDCB の呼び出し"""

import time
import threading
from quart import request, abort
from .albums_cache import _get_albums_cached
from .epg_build import _build_tsid_map, _build_epg_for_service  # noqa: F401
from .edcb_call import _epg_svc_cache, _epg_svc_cache_lock
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む


# キーワードなし検索用キャッシュ（全 EPG 取得は遅いため 5 分キャッシュ）
_epg_cache: list | None = None
_epg_cache_ts: float = 0
_epg_cache_lock = threading.Lock()
_EPG_CACHE_TTL = 300  # seconds


# 録画 augmented 一覧キャッシュ。_build_rec_aug_result は recordings 全件(約1000件)を
# DB から再構築するため重い(ウォーム約700ms / コールド約5秒)。フィルタ変更や30秒
# ポーリングのたびに走ると遅いので短い TTL でキャッシュする。書き込み(非GET)後は
# after_request で即無効化し、録画の見張り・エンコードの実行のワーカーによる routes を介さない DB 更新は TTL で取り込む。
# building フラグ + Condition で single-flight 化し、起動直後に複数リクエストが同時に
# キャッシュミスして並走ビルドする(互いを遅くする)のを防ぐ（先頭1本だけビルド、他は待って共有）。
_rec_aug_cache = {'ts': 0.0, 'data': None, 'building': False}
_rec_aug_cond = threading.Condition()
_REC_AUG_CACHE_TTL = 35.0  # seconds — 30秒ポーリング間隔に合わせて1サイクルに1回だけビルド


def _invalidate_rec_aug_cache():
    with _rec_aug_cond:
        _rec_aug_cache['data'] = None


def _clear_epg_caches():
    """手動 EPG 取得/再読込時にサーバー側 EPG キャッシュを破棄する。"""
    global _epg_cache, _epg_cache_ts
    with _epg_svc_cache_lock:
        _epg_svc_cache.clear()
    with _epg_cache_lock:
        _epg_cache = None
        _epg_cache_ts = 0


def _get_all_epg(client) -> list:
    global _epg_cache, _epg_cache_ts
    with _epg_cache_lock:
        if _epg_cache is not None and (time.time() - _epg_cache_ts) < _EPG_CACHE_TTL:
            return _epg_cache
    items = client.search_event()
    with _epg_cache_lock:
        _epg_cache = items
        _epg_cache_ts = time.time()
    return items


# 複数クライアントが augmented 系を同時ポーリングすると enum_reserve_info への
# ブロッキング EDCB 呼び出しが重複する。短期 TTL で共有キャッシュして負荷を平す。
_reserve_cache = {'ts': 0.0, 'data': None}
_reserve_cache_lock = threading.Lock()


def _invalidate_reserve_cache():
    # 予約 追加/skip/有効化/削除 直後の refreshReserves() が古い5秒キャッシュを返さないよう、
    # 書き込み(非GET)後に EDCB 予約一覧キャッシュを捨てる（番組表への即時反映用）。
    with _reserve_cache_lock:
        _reserve_cache['data'] = None


async def _json():
    """リクエストボディの JSON を取得。不正な場合は 400"""
    body = await request.get_json(silent=True)
    if body is None:
        abort(400, description='JSON body required')
    return body


def _require_admin():
    """管理者のみ許可（設定変更/接続テスト/再起動などの書き込み系API用）。

    federation 中継(X-Fed-Token)は管理者相当として通す。中継には利用者の JWT クッキーが
    付かないので current_user() は必ず None になり、そのままではマスターの設定画面から
    スレーブの設定を保存できない。fed_token は共有シークレットで、設定できるのは双方の
    管理者だけ。before_request で照合済み かつ _FED_ALLOWED のパスに限られるため、
    ここへ到達している時点で認証済みの管理操作とみなせる。
    （中継元での管理者判定は node_proxy 側で行う）
    """
    if request.headers.get('X-Fed-Token') is not None:
        return None
    from api.auth_routes.auth import current_user
    user = current_user()
    if not user or not user.get('is_admin'):
        abort(403, description='管理者のみ操作できます')
    return user


def warm_epg_albums(edcb_client, video_db, logger, tsid_store=None, dir_roots=None, users_db=None) -> None:
    """起動時ウォームアップ。番組表(全TVサービス, basic=0)とアルバム一覧のキャッシュを
    バックグラウンドで先に温める。リクエストコンテキスト外から呼べるよう client/db/logger は
    明示渡し（current_app を使わない）。EDCB を圧迫しないよう逐次実行する。
    """
    try:
        services = edcb_client.enum_service()
        tsid_map = _build_tsid_map(services)
        if tsid_store is not None:
            # get_epg が初回に enum_service を引き直さないよう共有マップを入れておく
            tsid_store['_tsid_sids'] = tsid_map
        targets = [(s.get('onid', 0), s.get('tsid'), s.get('sid'))
                   for s in services
                   if s.get('service_type') == 1
                   and s.get('tsid') is not None and s.get('sid') is not None]
        ok = 0
        for onid, tsid, sid in targets:
            try:
                _build_epg_for_service(edcb_client, onid, tsid, sid, basic=0,
                                       tsid_map=tsid_map, write_cache=True)
                ok += 1
            except Exception as e:
                logger.warning('EPG warm-up: %s-%s-%s failed: %s', onid, tsid, sid, e)
        logger.info('EPG cache warmed up: %d/%d services', ok, len(targets))
    except Exception as e:
        logger.warning('EPG warm-up failed: %s', e)

    try:
        if video_db is not None:
            # 非公開カテゴリは利用者ごとに箱が違うので、利用者が決めている組み合わせも温める
            # （温めていない箱は、起動して最初に開いた時に数秒かかっていた）
            sets = {()}
            if users_db is not None:
                for u in users_db.list_users():
                    sets.add(tuple(sorted(users_db.get_prefs(u['id']).get('private_categories') or ())))
            for cats in sets:
                _get_albums_cached(video_db, dir_roots or [], list(cats) or None, 'video')
            logger.info('albums cache warmed up (%d)', len(sets))
    except Exception as e:
        logger.warning('albums warm-up failed: %s', e)


def _delete_thumbnail_files(thumbnail_path: str, thumbnail_tile_path: str):
    """サムネイルファイルを削除する。"""
    import os
    for p in [thumbnail_path, thumbnail_tile_path]:
        if not p:
            continue
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


