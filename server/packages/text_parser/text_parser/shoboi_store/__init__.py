"""しょぼいカレンダーの番組表と作品情報を手元に置き、6時間ごとに取り直す。

もとは shoboi_store.py の1ファイル。中身ごとに分けた。"""
from .store import _KEEP_DAYS, _PROGS_FRESH_FOR, _SYNC_INTERVAL, _conn, _set_state, _state, has_program, info_for, program_at, program_by_pid, save_prog_items, save_title_items, title, title_info_from_item, title_names, waits_for_program_info, window  # noqa: F401
from .sync import _lookup, sync, sync_if_due, sync_pending, synced_at  # noqa: F401
