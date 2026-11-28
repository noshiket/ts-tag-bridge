"""ジョブの一覧・取り消し・今のジョブ（状態の入れ物と、終わった分の片付けは queue が持つ）"""

from datetime import datetime
from .queue import _jobs, _jobs_lock, _queue


def list_jobs(limit=20):
    """解析の一覧（実行中・順番待ち・直近の完了）。設定画面に出す用。"""
    with _jobs_lock:
        jobs = [dict(j) for j in _jobs.values()]
    order = {'running': 0, 'queued': 1}
    jobs.sort(key=lambda j: (order.get(j['state'], 2),
                             j.get('queue_position') or 0,
                             j['started_at']))
    out = []
    for j in jobs[:limit]:
        out.append({k: j.get(k) for k in
                    ('id', 'video_id', 'kind', 'state', 'queue_position',
                     'started_at', 'finished_at', 'error')}
                   | {'source_name': (j.get('source') or {}).get('name'),
                      'last_log': (j.get('log') or [''])[-1],
                      'added': (j.get('result') or {}).get('added')})
    return out


def cancel_job(job_id):
    """順番待ちのものを取り消す。実行中のものは止められない。"""
    with _jobs_lock:
        for k, (qid, _fn) in enumerate(_queue):
            if qid == job_id:
                _queue.pop(k)
                j = _jobs.get(job_id)
                if j is not None:
                    j.update(state='error', error='取り消しました',
                             finished_at=datetime.now().isoformat())
                    j.pop('queue_position', None)
                for i, (rid, _f) in enumerate(_queue):
                    r = _jobs.get(rid)
                    if r is not None:
                        r['queue_position'] = i + 1
                return True
    return False


def current_job(video_id=None):
    """実行中のジョブを返す（無ければ直近の1件）。

    job_id は画面の状態にしか無いので、ページを読み込み直すと解析中でも
    追えなくなっていた。動画を開いた時にこれで拾い直す。
    """
    with _jobs_lock:
        jobs = [dict(j) for j in _jobs.values()
                if video_id is None or j.get('video_id') == video_id]
    running = [j for j in jobs if j['state'] == 'running']
    if running:
        return max(running, key=lambda j: j['started_at'])
    return max(jobs, key=lambda j: j['started_at']) if jobs else None
