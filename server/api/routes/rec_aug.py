"""録画一覧（augmented）の組み立てと、ライブラリとの重複の判定"""

import time
from quart import (
    current_app,
)
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む
from .caches import (  # noqa: F401
    _REC_AUG_CACHE_TTL,
    _rec_aug_cache,
    _rec_aug_cond,
)
from .parser import (  # noqa: F401
    _ruledb,
)
from .rec_aug_dups import _build_video_dup_map
from .rec_aug_rows import _rec_aug_row


# ---------------------------------------------------------------------------
# GUI用 augmented エンドポイント（EDCB + rule_db マージ）
# ---------------------------------------------------------------------------


def _build_rec_aug_result(db=None, logger=None) -> list:
    """録画 augmented 一覧を返す。TTL キャッシュ + single-flight。

    有効キャッシュがあれば即返す。無ければ先頭1スレッドだけがビルドし、
    並走する他スレッドはその完了を待って同じ結果を共有する（コールド起動時の
    並走ビルドによる相互遅延を防ぐ）。返すリストは呼び出し側で読み取り専用に扱うこと。

    db / logger は起動時ウォームアップ（app context 外のスレッド）から明示渡しするための引数。
    省略時はリクエストコンテキストの current_app から取得する。
    """
    with _rec_aug_cond:
        cached = _rec_aug_cache['data']
        if cached is not None and (time.monotonic() - _rec_aug_cache['ts']) < _REC_AUG_CACHE_TTL:
            return cached
        # 既にビルド中なら完了を待ち、出来たての結果を共有する
        if _rec_aug_cache['building']:
            _rec_aug_cond.wait_for(lambda: not _rec_aug_cache['building'], timeout=30)
            cached = _rec_aug_cache['data']
            if cached is not None and (time.monotonic() - _rec_aug_cache['ts']) < _REC_AUG_CACHE_TTL:
                return cached
            # 待っても有効キャッシュが無い(タイムアウト/無効化)場合は自分でビルドする
        _rec_aug_cache['building'] = True

    try:
        result = _build_rec_aug_result_uncached(db=db, logger=logger)
        with _rec_aug_cond:
            _rec_aug_cache['data'] = result
            _rec_aug_cache['ts'] = time.monotonic()
        return result
    finally:
        with _rec_aug_cond:
            _rec_aug_cache['building'] = False
            _rec_aug_cond.notify_all()


def _build_rec_aug_result_uncached(db=None, logger=None) -> list:
    """rule_db recordings テーブルから一覧を構築（EDCB API不要・キャッシュなし）。

    db / logger 省略時は current_app から取得（リクエストコンテキスト内）。
    """
    _t0 = time.monotonic()
    if db is None:
        db = _ruledb()
    db_recs = db.list_recordings()
    _t1 = time.monotonic()
    # programs を一括取得（N+1 回避）
    programs = {p['id']: p for p in db.list_rules()}
    _t2 = time.monotonic()

    # 既存videoとの重複表示: 全videoの索引を一括プリフェッチ(N+1回避)し、
    # (album, series, 話数, サブタイトル)で照合する。federation送信側はマスター側索引も統合。
    dup_map = _build_video_dup_map()

    result = [_rec_aug_row(rec, programs, dup_map) for rec in db_recs]
    result.sort(key=lambda x: x.get('title') or '')
    result.sort(key=lambda x: x.get('start_time') or '', reverse=True)
    _t3 = time.monotonic()
    _total = _t3 - _t0
    _log = logger if logger is not None else current_app.logger
    _log.debug(
        '[rec_aug timing] total=%.2fs list_recordings=%.2fs list_rules=%.2fs build+sort=%.2fs recs=%d',
        _total, _t1 - _t0, _t2 - _t1, _t3 - _t2, len(db_recs))
    return result


