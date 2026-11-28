"""受け取る録画の置き場所（一時置き場・既定の受け取り先・同じ番組の録画）"""

import data_paths
import os
from quart import current_app


def _recording_staging_root() -> str:
    cfg = current_app.config['ENCODE_AUTO']
    base = cfg.get('tmp_base') or data_paths.DATA_DIR
    return os.path.join(base, 'fed_recording')


def _find_existing_by_event(rule_db, event: dict):
    """同一番組(サービス4ID+eit_start_time)の既存録画を返す(冪等判定)。無ければ None。"""
    keys = ('onid', 'tsid', 'sid', 'eid', 'eit_start_time')
    vals = [event.get(k) for k in keys] if isinstance(event, dict) else [None]
    if any(v in (None, '') for v in vals):
        return None
    rows = rule_db.find_recordings_by_event(*vals)
    return rows[0] if rows else None


def _default_recv_dir(cfg: dict, rule_db) -> str:
    """転送TSの受信先: 既存録画(EDCB管理)と同じフォルダ。無ければ tmp_base/delegate_recv。"""
    try:
        for rec in rule_db.list_recordings():
            if rec.get('rec_id') is None:
                continue
            p = rec.get('host_ts_path') or ''
            d = os.path.dirname(p)
            if d and os.path.isdir(d):
                return d
    except Exception:
        pass
    base = cfg.get('tmp_base') or data_paths.DATA_DIR
    return os.path.join(base, 'delegate_recv')
