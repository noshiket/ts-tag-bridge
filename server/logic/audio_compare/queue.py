"""ジョブの一覧と順番待ち（重い処理は1本ずつ）。ずれの測り直しは実行中の印を自分で立てるのでここに置く"""

import logging
import threading
import time
import uuid
from datetime import datetime


logger = logging.getLogger('logic.audio_compare')   # 分ける前と同じ名前で出す

_jobs = {}
_jobs_lock = threading.Lock()
_running = False            # 解析は同時1本まで
_queue = []                 # 順番待ち [(job_id, 実処理)]
_draining = False           # 順番待ちを捌くスレッドが動いているか
_MAX_FINISHED_JOBS = 20


# ---------------------------------------------------------------------------
# ジョブ
# ---------------------------------------------------------------------------

def _prune_finished():
    """完了/失敗ジョブが増えすぎたら古い順に破棄する(要 _jobs_lock 保持)。"""
    done = [(j['finished_at'] or '', jid) for jid, j in _jobs.items()
            if j['state'] in ('done', 'error')]
    for _, jid in sorted(done)[:max(0, len(done) - _MAX_FINISHED_JOBS)]:
        _jobs.pop(jid, None)


def get_job(job_id):
    with _jobs_lock:
        j = _jobs.get(job_id)
        return dict(j) if j else None


def is_running() -> bool:
    with _jobs_lock:
        return _running


def _submit(job_id, fn):
    """順番待ちへ積む。解析は CPU/IO を食うので1本ずつ順に流す。

    以前は2本目を 409 で断っていたが、1本3分ほどかかるので待たせたほうが使える。
    """
    global _draining
    with _jobs_lock:
        _queue.append((job_id, fn))
        pos = len(_queue)
        j = _jobs.get(job_id)
        if j is not None and (_running or pos > 1):
            j['queue_position'] = pos
        start = not _draining
        _draining = True
    if start:
        threading.Thread(target=_drain, daemon=True, name='AudioCompareQueue').start()
    return pos


def _drain():
    """順番待ちを1本ずつ流す。"""
    global _running, _draining
    while True:
        with _jobs_lock:
            if not _queue:
                _draining = False
                return
            job_id, fn = _queue.pop(0)
            j = _jobs.get(job_id)
            if j is not None:
                j['state'] = 'running'
                j.pop('queue_position', None)
            for k, (qid, _f) in enumerate(_queue):     # 残りの待ち順を詰める
                q = _jobs.get(qid)
                if q is not None:
                    q['queue_position'] = k + 1
            _running = True
        try:
            fn()
        except Exception:
            logger.exception('audio_compare: 順番待ちの処理で例外')
        finally:
            with _jobs_lock:
                _running = False


def _new_job(kind: str, video_id, source: dict, label: str):
    """ジョブを順番待ちの一覧へ載せ、(job_id, log, finish) を返す。

    log(msg)            進捗を1行足す（label を付けてサーバーのログにも出す）
    finish(state, **kw) 'done' / 'error' で終わらせる。result= や error= を渡す
    """
    with _jobs_lock:
        job_id = uuid.uuid4().hex[:12]
        _jobs[job_id] = {
            'id': job_id, 'video_id': video_id, 'source': source, 'kind': kind,
            'state': 'queued', 'log': [], 'result': None, 'error': None,
            'started_at': datetime.now().isoformat(), 'finished_at': None,
        }
        _prune_finished()

    def log(msg):
        line = f'[{time.strftime("%H:%M:%S")}] {msg}'
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j is not None:
                j['log'].append(line)
        logger.info('%s: %s', label, msg)

    def finish(state, **kw):
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j is not None:
                j.update(state=state, finished_at=datetime.now().isoformat(), **kw)

    return job_id, log, finish


def start_job(kind: str, video_id, source: dict, run):
    """この順番待ちへ任意の重い処理を積む（音楽の取り込み等、比較以外からも使う）。

    run(log, finish) -> None
      log(msg)                進捗を1行足す（設定＞アプリのキューにも出る）
      finish(state, **kw)     'done' / 'error' で終わらせる。result= や error= を渡す。
    戻り: job_id
    """
    job_id, _log, _finish = _new_job(kind, video_id, source or {}, f'{kind}({video_id})')

    def _worker():
        try:
            run(_log, _finish)
        except Exception as e:
            _log(f'エラー: {e}')
            logger.exception('%s(%s) 失敗', kind, video_id)
            _finish('error', error=str(e))

    _submit(job_id, _worker)
    return job_id


def start_frame_sync(video_id: int, path_a: str, path_b: str, source: dict, matches,
                     ffmpeg: str, opts: dict):
    """共通区間のずれをサンプル単位まで測り直すジョブを開始し job_id を返す。

    音声比較(start)の結果を入力に取る後段。粒度が 500ms のままだと字幕が最大数
    フレームずれるので、波形を直接突き合わせて測り直す(logic.frame_sync)。
    戻り: ('busy', None) 実行中 / ('nomatch', None) 共通区間なし / (None, job_id) 正常。
    """
    global _running
    from logic import frame_sync

    if not matches:
        return 'nomatch', None
    job_id, _log, _finish = _new_job('frame_sync', video_id, source,
                                     f'frame_sync(video={video_id})')
    nice = int(opts.get('nice', frame_sync._NICE))
    max_load = opts.get('max_load')

    def _worker():
        import shutil
        import tempfile
        wav_dir = tempfile.mkdtemp(prefix='fsync_')
        try:
            ranges = frame_sync.refine(path_a, path_b, matches, ffmpeg=ffmpeg,
                                       on_log=_log, wav_dir=wav_dir,
                                       nice=nice, max_load=max_load)
            video = []
            if opts.get('verify_video', True):
                # 放送異常告知がある側は L字テロップで画面が動いている可能性があり、
                # 判定が 1フレームぶん散る。告知が無ければ厳しく見る
                announce = bool(source.get('announce') or source.get('announce_self'))
                tol = (frame_sync._OK_FRAMES_ANNOUNCE if announce
                       else frame_sync._OK_FRAMES)
                # 判定点は無音＋場面の切り替わり。chapter_txt が無ければ
                # marks_fn が再解析して tag.json へ残す（約25秒）
                marks = opts.get('marks_fn')(_log) if opts.get('marks_fn') else None
                hints = frame_sync.segment_edge_hints(opts.get('trim_segments'), ranges,
                                                      chapter_txt=opts.get('chapter_txt'),
                                                      marks=marks)
                _log(f'映像が同じずれで合っているか確認します（許容 ±{tol}フレーム'
                     f'{" / 放送異常告知あり" if announce else ""}'
                     f'{f" / チャプター区間の端 {sum(len(v) for v in hints.values())}箇所を使用" if hints else ""}）')
                # チャプター境界（A と B の細かい方で割る）と、音声の局所確認用の波形
                video = frame_sync.verify_video(
                    path_a, path_b, ranges, ffmpeg=ffmpeg, on_log=_log, tolerance=tol,
                    hints=hints, wav_dir=wav_dir, nice=nice, max_load=max_load,
                    bounds_a=frame_sync.chapter_marks(opts.get('chapter_txt')),
                    bounds_b=opts.get('bounds_b'))
            _finish('done', result={
                'ranges': ranges, 'video': video, 'source': source,
                'build_ranges': [list(r) for r in frame_sync.to_build_ranges(ranges)],
            })
        except Exception as e:
            _log(f'エラー: {e}')
            logger.exception('frame_sync(video=%s) 失敗', video_id)
            _finish('error', error=str(e))
        finally:
            shutil.rmtree(wav_dir, ignore_errors=True)

    _submit(job_id, _worker)
    return None, job_id
