"""アドオンの仕事を始める（レーンに積む・裏で動かす）"""

import sys
import json
import time
import uuid
import threading
import traceback
from datetime import datetime
from .loader import _busy_videos, _jobs, _jobs_lock
from .discovery import _find_entry, _load_module, logger
from .params import _schema_of
from .contexts import VideoAddonContext
from .lanes import _lane_submit, _prune_finished


def start_addon(name, video_id, params, config, video_db, rule_db, users_db,
                recording_id=None, inline=False):
    """videoアドオンをバックグラウンド実行しjob_idを返す。

    recording_id を渡すと、ライブラリ動画ではなく録画(TS)を対象にする。
    ロゴ生成のように元のTSが要るアドオン用で、ctx.video には recordings の行が入り
    ctx.video['file_path'] が TS のパスになる（video_id は None）。

    例外時の戻り: ('busy', None) / ('not_found', None) / ('video_not_found', None) /
    正常時 (None, job_id)。
    """
    if recording_id is not None:
        rec = rule_db.get_recording(recording_id) if rule_db else None
        ts = (rec or {}).get('app_ts_path') or (rec or {}).get('edcb_ts_path') or ''
        if not rec or not ts:
            return 'video_not_found', None
        video = {**rec, 'file_path': ts}
        video_id = None
    else:
        video = video_db.get_video_row(video_id)
        if video is None or not video.get('file_path'):
            return 'video_not_found', None
    entry, spdir = _find_entry(name)
    if entry is None:
        return 'not_found', None
    tag_path = video['file_path'] + '.tag.json'
    try:
        with open(tag_path, encoding='utf-8') as f:
            tag = json.load(f)
    except Exception:
        tag = {}

    # 同時実行の抑止キー。録画対象は video_id が無いので 'rec:<id>' で区別する
    busy_key = f'rec:{recording_id}' if recording_id is not None else video_id
    with _jobs_lock:
        if busy_key in _busy_videos:
            return 'busy', None
        _busy_videos.add(busy_key)
        job_id = uuid.uuid4().hex[:12]
        _jobs[job_id] = {
            'id': job_id, 'addon': name, 'video_id': video_id,
            'recording_id': recording_id,
            'state': 'running', 'log': [], 'result': None, 'error': None,
            'started_at': datetime.now().isoformat(), 'finished_at': None,
        }
        _prune_finished()

    def _log(msg):
        line = f'[{time.strftime("%H:%M:%S")}] {msg}'
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j is not None:
                j['log'].append(line)
        logger.info('addon %s(%s): %s', name, busy_key, msg)

    def _worker():
        try:
            mod = _load_module(name, entry, spdir)
            schema = _schema_of(name, mod)
            ctx = VideoAddonContext(video_id, video, tag, tag_path,
                                    video_db, rule_db, users_db, config, _log)
            # ディレクトリ形式は実行中も同梱importできるようsys.pathへ追加
            if spdir and spdir not in sys.path:
                sys.path.insert(0, spdir)
            try:
                result = mod.run(ctx, dict(params or {}))
            finally:
                if spdir:
                    try:
                        sys.path.remove(spdir)
                    except ValueError:
                        pass
            # busy解放はstate確定と同じロック内で行う(先にstateだけ確定すると、
            # ポーリングで完了を見た直後の再実行が409になる隙間ができる)
            with _jobs_lock:
                j = _jobs.get(job_id)
                if j is not None:
                    j['state'] = 'done'
                    j['result'] = result if isinstance(result, (dict, list)) else (
                        str(result) if result is not None else None)
                    j['finished_at'] = datetime.now().isoformat()
                _busy_videos.discard(busy_key)
            logger.info('addon %s(%s): 完了 (%s)', name, busy_key, schema['label'])
        except Exception as e:
            _log(f'エラー: {e}')
            with _jobs_lock:
                j = _jobs.get(job_id)
                if j is not None:
                    j['state'] = 'error'
                    j['error'] = str(e)
                    j['log'].append(traceback.format_exc(limit=8))
                    j['finished_at'] = datetime.now().isoformat()
                _busy_videos.discard(busy_key)
            logger.error('addon %s(%s) failed: %s', name, busy_key, e)
        finally:
            with _jobs_lock:
                _busy_videos.discard(busy_key)  # 保険(上で解放済みなら no-op)

    if inline:
        # エンコードキューから呼ばれた場合。レーンにも積まず、エンコードの
        # 終わりも待たない（待つ相手が自分自身になり、永久に止まる）。
        # 順番待ちは呼び出し側（エンコードの実行が1件ずつ）が受け持つ。
        _worker()
        return None, job_id

    # ADDON['queue'] があれば、そのレーンで1本ずつ順に流す（無ければ即実行）
    lane = None
    try:
        sch = _schema_of(name, _load_module(name, entry, spdir)) or {}
        lane = sch.get('queue')
    except Exception:
        lane = None   # 読めなければ従来どおり。実際の失敗は _worker が拾って出す
    if lane:
        run = _worker
        _lane_submit(str(lane), job_id, run, _log)
    else:
        threading.Thread(target=_worker, daemon=True, name=f'Addon-{name}').start()
    return None, job_id
