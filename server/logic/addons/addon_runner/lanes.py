"""アドオンの仕事の順番待ち（ADDON['queue'] のレーンごとに1本ずつ）と、終わった仕事の片付け"""

import threading
from .loader import _MAX_FINISHED_JOBS, _jobs, _jobs_lock, _lane_active, _lane_queues
from .discovery import logger


def _prune_finished():
    """完了/失敗ジョブが増えすぎたら古い順に破棄する(要_jobs_lock保持)。"""
    done = [(j['finished_at'] or '', jid) for jid, j in _jobs.items()
            if j['state'] in ('done', 'error')]
    if len(done) <= _MAX_FINISHED_JOBS:
        return
    for _, jid in sorted(done)[:len(done) - _MAX_FINISHED_JOBS]:
        _jobs.pop(jid, None)


def _lane_submit(lane, job_id, fn, log):
    """レーンの順番待ちへ積む。空いていればその場で流し始める。"""
    with _jobs_lock:
        q = _lane_queues.setdefault(lane, [])
        q.append((job_id, fn))
        pos = len(q)
        start = lane not in _lane_active
        if start:
            _lane_active.add(lane)
        j = _jobs.get(job_id)
        if j is not None and not (start and pos == 1):
            j['queue_position'] = pos
            j['state'] = 'queued'        # 画面に「順番待ち」と出すため
    if not (start and pos == 1):
        log(f'順番待ち {pos}番目（{lane} は1本ずつ実行します）')
    if start:
        threading.Thread(target=_lane_drain, args=(lane,), daemon=True,
                         name=f'AddonQueue-{lane}').start()


def _lane_drain(lane):
    """レーンの順番待ちを1本ずつ流す。"""
    while True:
        with _jobs_lock:
            q = _lane_queues.get(lane) or []
            if not q:
                _lane_active.discard(lane)
                return
            job_id, fn = q.pop(0)
            j = _jobs.get(job_id)
            if j is not None:
                j.pop('queue_position', None)
                j['state'] = 'running'
            for k, (qid, _f) in enumerate(q):     # 残りの待ち順を詰める
                jj = _jobs.get(qid)
                if jj is not None:
                    jj['queue_position'] = k + 1
        try:
            fn()
        except Exception:
            logger.exception('addon: 順番待ちの処理で例外 (%s)', lane)
