"""drop_debug — ドロップ発生時刻と add_recording のスキャン区間を突き合わせ、
encode_auto 自身のディスク酷使スキャンがドロップを誘発したかをデバッグログに残す。

config の drop_debug: true で有効。無効時は add_recording 側が呼び出さないので無コスト。

スキャン区間はプロセス内メモリ（最近 _RETENTION 分）に保持する。録画完了直後に
スキャンが走り、その録画は同一プロセス稼働中に処理されるため、メモリ保持で相関に十分。
出力は server/data/drop_debug.log（rules.db と同ディレクトリ）。
"""

import json
import logging
import os
import threading
from collections import deque
from datetime import datetime, timedelta

_RETENTION = timedelta(hours=24)

_lock = threading.Lock()
# [(rec_id, file, started_at: datetime, ended_at: datetime), ...]
_scan_log: deque = deque()

_logger: logging.Logger | None = None


def _get_logger(db) -> logging.Logger:
    """drop_debug.log への専用ロガーを遅延生成する。"""
    global _logger
    if _logger is not None:
        return _logger
    log_path = os.path.join(os.path.dirname(db.db_path), 'drop_debug.log')
    lg = logging.getLogger('drop_debug')
    lg.setLevel(logging.INFO)
    lg.propagate = False
    if not lg.handlers:
        h = logging.FileHandler(log_path, encoding='utf-8')
        h.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        lg.addHandler(h)
    _logger = lg
    return lg


def record_scan(rec_id: int, file: str, started_at: datetime, ended_at: datetime) -> None:
    """1回のディスク酷使スキャンの区間を記録する（drop_debug 有効時のみ呼ばれる）。"""
    with _lock:
        _scan_log.append((rec_id, file, started_at, ended_at))
        cutoff = datetime.now() - _RETENTION
        while _scan_log and _scan_log[0][3] < cutoff:
            _scan_log.popleft()


def _overlapping_scans(rec_id: int, tot: datetime) -> list:
    """tot 時刻に走っていた、rec_id 以外のスキャン区間を返す。"""
    with _lock:
        return [s for s in _scan_log
                if s[0] != rec_id and s[2] <= tot <= s[3]]


def correlate(db, rec_id: int, file: str, drop_json: str) -> None:
    """録画のドロップ tot_time を、他録画のスキャン区間と突き合わせてログ出力する。"""
    try:
        d = json.loads(drop_json) if isinstance(drop_json, str) else drop_json
    except (ValueError, TypeError):
        return
    errors = [e for e in (d.get('errors') or []) if e.get('tot_time')]
    if not errors:
        return

    lg = _get_logger(db)
    fname = os.path.basename(file)
    matched = 0
    seen_tot = set()
    for e in errors:
        try:
            tot = datetime.fromisoformat(e['tot_time'])
        except (ValueError, TypeError):
            continue
        scans = _overlapping_scans(rec_id, tot)
        # 同一 tot_time の複数 PID ドロップは1行にまとめる
        tot_key = e['tot_time']
        if scans and tot_key not in seen_tot:
            seen_tot.add(tot_key)
            matched += 1
            active = _active_recording_count(db, tot, rec_id)
            for s in scans:
                lg.info(
                    'DROP rec=%d file=%s @%s (%s pid=%s) ← OVERLAPS scan rec=%d file=%s [%s–%s] | concurrent_rec=%s',
                    rec_id, fname, e['tot_time'], e.get('stream_category'), e.get('pid'),
                    s[0], s[1], s[2].strftime('%H:%M:%S'), s[3].strftime('%H:%M:%S'), active,
                )

    lg.info('SUMMARY rec=%d file=%s drops=%d overlapped_encode_auto_scan=%d',
            rec_id, fname, len(errors), matched)


def _active_recording_count(db, tot: datetime, exclude_rec_id: int) -> int:
    """tot 時刻に物理録画中だった recordings 件数（自身を除く）。recording_*_time 基準。"""
    try:
        ts = tot.isoformat()
        row = db._get_conn().execute(
            """SELECT COUNT(*) FROM recordings
               WHERE id != ?
                 AND recording_start_time IS NOT NULL
                 AND recording_end_time IS NOT NULL
                 AND recording_start_time <= ? AND recording_end_time >= ?""",
            (exclude_rec_id, ts, ts),
        ).fetchone()
        return row[0] if row else 0
    except Exception:
        return 0
