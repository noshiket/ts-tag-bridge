"""後付けの CM 解析（分割画面の「CM解析」ボタン）の順番待ち"""

import threading
import time
from datetime import datetime as _dt
from .parse import (  # noqa: F401
    logger,
)
from logic.encoding import load_weights


def _analyze_cm(db, rec_id, ts_path, config, logger, force=False, abort=None):
    """CMカット解析を走らせて recordings.cm_analysis に入れる。

    解析そのものは logic/cmcut.py。30分番組で2分前後・4コアを使い切るので、
    録画が重なる時間帯は素直に重い。要らない場合は config.yml の
    cmcut_on_scan を false にする。

    abort: 録画登録スキャンが渡す「録画が消された・解析中止か」。真なら途中で止める（cmcut.Aborted）。

    force=True は分割画面からのやり直し。解析済みでも作り直し、
    cmcut_on_scan が false でも走らせる（人が押したものを黙って捨てない）。
    """
    import json

    from logic import cmcut

    rec = db.get_recording(rec_id)
    if rec is None:
        return False
    cfg = config or {}
    if not force:
        if rec.get('cm_analysis'):
            return False                     # 解析済みは触らない
        if not cfg.get('cmcut_on_scan', True):
            return False
    sid = None
    if rec.get('addon'):
        # 配信の取り込みには放送の serviceId が無い。どの局の設定を借りるかは
        # 録画したアドオンが知っているので尋ねる（無ければ従来どおり）
        try:
            from logic.addons import addon_runner
            sid = addon_runner.cm_analysis_service_id(rec)
        except Exception:
            sid = None
    if not sid:
        sid = cmcut.service_id_of(rec)
    if not sid:
        # 登録スキャン側は例外を握り潰して先へ進む。手で押したときに
        # 「なぜ出来なかったのか」を返したいので、黙って戻らず投げる
        raise ValueError('この録画のチャンネル(serviceId)が分からないため解析できません')
    t0 = time.time()
    res = cmcut.analyze(ts_path, service_id=sid, rec_id=rec_id,
                        recorded_at=cmcut.recorded_at_of(rec),
                        # 並列数・優先度・並列を落とす負荷は設定の重さ（控えめ・ふつう・全力）で決める。
                        # この機械は録画・エンコード・配信を同時にやるので、急がない登録スキャンは譲る
                        config=cfg, params={'keep_work': False, **load_weights.cmcut_params(cfg),
                                            'abort': abort},
                        log=lambda m: logger.debug('cmcut[%d] %s', rec_id, m))
    db.update_recording(rec_id, cm_analysis=json.dumps(res, ensure_ascii=False))
    logger.info('add_recording: recording_id=%d CM解析 完了 %.0f秒 / 残す区間 %d個',
                rec_id, time.time() - t0, len(res.get('trim_segments') or []))
    return True


# ── 後付けのCM解析(分割画面の「CM解析」ボタン) ─────────────────────────────
# 登録スキャン時の解析は1本ずつ順に走るが、こちらは人が押した分なので
# 何本も同時に走らないよう1本ずつ流す（1本で4コアを使い切るため）。
_cm_jobs = {}            # rec_id -> {'state','started_at','finished_at','error'}
_cm_queue = []           # 順番待ちの [(rec_id, 実処理)]
_cm_lock = threading.Lock()
_cm_draining = False     # 順番待ちを捌くスレッドが動いているか


def cm_job(rec_id):
    """後付けCM解析の状態。走らせていなければ None。"""
    with _cm_lock:
        j = _cm_jobs.get(int(rec_id))
        if j is None:
            return None
        j = dict(j)
        if j['state'] == 'queued':
            j['queue_position'] = next(
                (i + 1 for i, (rid, _f) in enumerate(_cm_queue) if rid == int(rec_id)), None)
        return j


def start_cm_analysis(db, rec_id, ts_path, config, logger):
    """CM解析を後付けで走らせる。既に走っていれば 'busy'、積めたら 'queued'。"""
    global _cm_draining
    rec_id = int(rec_id)
    with _cm_lock:
        cur = _cm_jobs.get(rec_id)
        if cur and cur['state'] in ('queued', 'running'):
            return 'busy'
        _cm_jobs[rec_id] = {'state': 'queued', 'started_at': _dt.now().isoformat(),
                            'finished_at': None, 'error': None}
        _cm_queue.append((rec_id, lambda: _cm_run(db, rec_id, ts_path, config, logger)))
        start = not _cm_draining
        if start:
            _cm_draining = True
    if start:
        threading.Thread(target=_cm_drain, daemon=True, name='CmAnalysis').start()
    return 'queued'


def _cm_run(db, rec_id, ts_path, config, logger):
    with _cm_lock:
        _cm_jobs[rec_id]['state'] = 'running'
    try:
        ok = _analyze_cm(db, rec_id, ts_path, config, logger, force=True)
        if ok:
            db.update_recording(rec_id, cm_error=None)
        state, err = ('done', None) if ok else ('error', '解析できませんでした')
    except Exception as e:
        logger.exception('add_recording: recording_id=%d CM解析(後付け)が失敗', rec_id)
        state, err = 'error', str(e)
        # ジョブ状態はメモリなので再起動で消える。理由は DB にも残す
        try:
            db.update_recording(rec_id, cm_error=f'{type(e).__name__}: {e}'[:500])
        except Exception:
            pass
    with _cm_lock:
        _cm_jobs[rec_id].update(state=state, error=err,
                                finished_at=_dt.now().isoformat())


def _cm_drain():
    global _cm_draining
    while True:
        with _cm_lock:
            if not _cm_queue:
                _cm_draining = False
                return
            _rec_id, fn = _cm_queue.pop(0)
        try:
            fn()
        except Exception:
            logger.exception('add_recording: CM解析の順番待ちで例外')
