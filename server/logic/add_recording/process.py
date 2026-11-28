"""録画1件の登録（process）"""

import json
import os
from datetime import datetime as _dt
from logic.recordings import drop_debug
from read_tsprogram import ScanAborted as _ScanAborted
from logic.recordings.segment_calculator import episode_list
from .parse import _apply_text_parser, logger
from .helpers import _apply_defaults, _gen_tmp_dirs
from .scan_file import _check_file_exists, _scan_file_info, _scan_drops_captions  # noqa: F401
from .scan_program import _scan_program_info  # noqa: F401
from .after_scan import _after_scan, _update_segments, _update_duplicate_info  # noqa: F401


def process(db, rec_id: int, config: dict, parser_store=None) -> None:
    """
    recording エントリを完全に処理する。
    state: pending → scanning → waiting / error / non_file

    addrec フローチャートに従い:
      1. file_exist チェック → non_file
      2. scan (ts_scanner / ffprobe / getsize / TOT / drop_check) → AR2 UPDATE
      3. text_parser 実行判定 (ARX)
      4. CONFIRMED VALUES 更新判定 (AR3)
      5. SEGMENTS 計算
      6. state=waiting
    """
    recording = db.get_recording(rec_id)
    if not recording:
        return

    db.update_recording(rec_id, state='scanning')
    gone = _gone_check(db, rec_id)
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path', '')

    # ── file_exist ─────────────────────────────────────────────────────────
    if not _check_file_exists(db, rec_id, recording, ts_path):
        return

    # ── スキャン (AR1 〜 AR1e2) ────────────────────────────────────────────
    scan_fields: dict = {'file_exist': 1}
    # 失敗した理由。state='error' だけ立てて理由を捨てると、画面には「エラー」
    # としか出ず、ログが流れた後は追えない（実測: EIT解析が
    # 「index out of range」で落ちていたのに error_message が空で、
    #  コードを辿るまで原因が分からなかった）。理由が1つでもあれば error にする
    error_reasons = []

    # drop_debug: ディスク酷使スキャンの開始時刻を記録（有効時のみ）
    _drop_dbg = bool(config.get('drop_debug'))
    _scan_t0 = _dt.now() if _drop_dbg else None

    _scan_file_info(rec_id, recording, ts_path, config, scan_fields, error_reasons)
    if gone():
        logger.info('add_recording: recording_id=%d 走査中に削除されたため中断', rec_id)
        return
    try:
        video_pid, program = _scan_drops_captions(rec_id, recording, ts_path, gone, scan_fields, error_reasons)
    except _ScanAborted:
        logger.info('add_recording: recording_id=%d 走査中に削除されたため中断', rec_id)
        return
    ts_result, sid = _scan_program_info(db, rec_id, recording, ts_path, scan_fields, error_reasons,
                                        program=program)
    if gone():
        logger.info('add_recording: recording_id=%d 走査中に削除されたため中断', rec_id)
        return

    # ── AR2: 一括 UPDATE ───────────────────────────────────────────────────
    state = 'error' if error_reasons else 'scanning'
    if error_reasons:
        # 理由を残す。消さない（再スキャンや再キューが None で上書きする経路が
        # あるので、error にする時は必ず書き直す）
        scan_fields['error_message'] = ' / '.join(error_reasons)[:500] or 'スキャンに失敗しました'
    db.update_recording(rec_id, state=state, **scan_fields)

    # drop_debug: スキャン区間を記録し、自身のドロップを他録画のスキャンと突き合わせる
    if _drop_dbg:
        drop_debug.record_scan(rec_id, os.path.basename(ts_path), _scan_t0, _dt.now())
        if scan_fields.get('drop_error'):
            drop_debug.correlate(db, rec_id, ts_path, scan_fields['drop_error'])

    if error_reasons:
        logger.warning('add_recording: recording_id=%d → error (scan failure): %s',
                       rec_id, ' / '.join(error_reasons))
        return

    _after_scan(db, rec_id, recording, ts_path, scan_fields, config, video_pid, sid, gone)
    if gone():
        logger.info('add_recording: recording_id=%d 走査中に削除されたため中断', rec_id)
        return

    # ── ARX / AR3: text_parser と確定値 ───────────────────────────────────
    recording = _apply_text_parser(db, rec_id, ts_result, sid, config, parser_store)
    if recording is None:
        logger.info('add_recording: recording_id=%d 走査中に削除されたため中断', rec_id)
        return

    # ── SEGMENTS ──────────────────────────────────────────────────────────
    ep_num_list  = episode_list(recording.get('episode_number'))
    ep_name_list = episode_list(recording.get('episode_name'))
    ep_count = max(len(ep_num_list), len(ep_name_list))
    logger.debug('add_recording: recording_id=%d ep_count=%d (num=%d name=%d)', rec_id, ep_count, len(ep_num_list), len(ep_name_list))
    if ep_count >= 1:
        _update_segments(db, rec_id, recording, ep_num_list, ep_name_list, ep_count)
        _update_duplicate_info(db, rec_id, recording, ep_num_list, ep_name_list)

    # ── TMP ディレクトリ名リスト生成 ──────────────────────────────────────
    # max(episode_number件数, episode_name件数) 分生成（なし/1件は1つ）
    tmp_dirs = _gen_tmp_dirs(ep_count)
    db.update_recording(rec_id, tmp_dirs=json.dumps(tmp_dirs, ensure_ascii=False))
    logger.debug('add_recording: recording_id=%d tmp_dirs=%s', rec_id, tmp_dirs)

    _apply_defaults(db, rec_id, config)

    # ── 完了: state=waiting ────────────────────────────────────────────────
    db.update_recording(rec_id, state='waiting')
    logger.info('add_recording: recording_id=%d → waiting', rec_id)


def _gone_check(db, rec_id):
    """走査中に録画詳細から削除された場合、または解析中止(scan_cancelled=1)を要求された場合に
    True を返す関数。以降の重い処理を打ち切る（RecordingScanWorker のループが次の pending を拾う）。"""
    def _gone() -> bool:
        rec = db.get_recording(rec_id)
        if rec is None:
            return True
        if rec.get('scan_cancelled'):
            # 中止要求: state を pending に戻して終わる。scan_cancelled は付けたままにして
            # ワーカーが即座に再開しないようにし、手動の再スキャンで解除する。
            db.update_recording(rec_id, state='pending')
            return True
        return False
    return _gone


