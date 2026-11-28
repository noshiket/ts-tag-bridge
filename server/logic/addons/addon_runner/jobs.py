"""アドオンの実行（同期・ジョブ・順番待ちのレーン）"""

import re
import threading
from .loader import _jobs, _jobs_lock
from .start import start_addon


# ---------------------------------------------------------------------------
# ジョブ実行
# ---------------------------------------------------------------------------

def get_job(job_id):
    with _jobs_lock:
        j = _jobs.get(job_id)
        return dict(j) if j else None


def _find_running_job(name, video_id):
    """走っているジョブの id を名前と動画から引く。

    inline=True の start_addon は終わってから job_id を返すので、走っている
    最中は呼び出し側が id を知らない。進捗を拾うにはここから引くしかない。
    """
    try:
        with _jobs_lock:
            for jid, j in reversed(list(_jobs.items())):
                if (j.get('state') == 'running' and j.get('addon') == name
                        and j.get('video_id') == video_id):
                    return jid
    except Exception:
        pass
    return None


def run_video_addon_sync(name, video_id, params, config, on_progress=None, on_log=None):
    """アドオンをその場で最後まで回す。エンコードキューから呼ぶための口。

    待ち行列はエンコードキュー(エンコードの実行)が受け持つので、レーンにも積まず、
    エンコードの終わりも待たない。待つと相手が自分自身になって止まる。

    進捗はアドオンのログに出る「○%」から拾う（アドオン側に進捗の口が無いため）。
    戻り: アドオンの戻り値。失敗なら例外。
    """
    from logic.addons import addon_events
    app = addon_events.app_context()
    prev_len = [0]

    def _tap(job_id):
        j = get_job(job_id) or {}
        lines = j.get('log') or []
        for line in lines[prev_len[0]:]:
            if on_log:
                on_log(line)
            m = re.search(r'(\d+(?:\.\d+)?)\s*%', line)
            if m and on_progress:
                try:
                    on_progress(float(m.group(1)))
                except Exception:
                    pass
        prev_len[0] = len(lines)

    holder = {}

    def _run():
        holder['err'], holder['job'] = start_addon(
            name, video_id, params, config,
            app.get('video_db'), app.get('rule_db'), None, inline=True)

    th = threading.Thread(target=_run, daemon=True, name=f'AddonQueue-{name}')
    th.start()
    while th.is_alive():
        th.join(2.0)
        # inline=True の start_addon は**終わってから**返るので、holder['job'] は
        # 最後まで空のまま。それを待っていると一度も拾えず、進捗が 0% で
        # 止まったままになる（実測: ログには「変換中 1%」が出ているのに
        # encodings.progress は 0.0 のままだった）。走っているジョブから探す。
        jid = holder.get('job') or _find_running_job(name, video_id)
        if jid:
            _tap(jid)
    jid = holder.get('job')
    if jid:
        _tap(jid)
    if holder.get('err'):
        raise RuntimeError(f'アドオンを開始できません: {holder["err"]}')
    job = get_job(jid) if jid else None
    if job is None:
        raise RuntimeError('ジョブの記録が見つかりません')
    if job.get('state') == 'error':
        raise RuntimeError(job.get('error') or 'アドオンが失敗しました')
    return job.get('result')


def list_jobs(active_only=True):
    """走っている/順番待ちのアドオンジョブ。エンコードキュー画面に出すため。

    レーンに積んだ変換は録画のエンコードキューには並ばないので、待っていても
    画面から分からなかった（「待つのはいいが、キューに加わったか分からない」）。
    軽い一覧なので、ログ本文は落として返す。
    """
    with _jobs_lock:
        out = []
        for j in _jobs.values():
            if active_only and j['state'] not in ('running', 'queued'):
                continue
            out.append({k: v for k, v in j.items() if k != 'log'}
                       | {'last_log': (j['log'] or [''])[-1]})
        # 順番待ちは待ち順、走っているものが先
        out.sort(key=lambda x: (x.get('queue_position') or 0, x.get('started_at') or ''))
        return out
