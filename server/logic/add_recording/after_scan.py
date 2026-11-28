"""録画登録の走査の後（区間・重複の情報を付ける）"""

import data_paths
import json
from logic.cmcut.proc import Aborted as _CmAborted
from logic.recordings.segment_calculator import calculate_segments, mark_registered_segments_skip
from .parse import _get_video_db, logger
from .helpers import _calc_overlap
from .comments import _fetch_and_store_comments
from .thumbnail import _generate_recording_thumbnail
from .cm import _analyze_cm


def _after_scan(db, rec_id, recording, ts_path, scan_fields, config, video_pid, sid, gone=None):
    """スキャンを保存した後の付帯処理（サムネ・重なり・コメント・フレーム表・CM 解析）。
    どれも失敗しても登録は続ける。"""
    # ── サムネイル生成 ─────────────────────────────────────────────────────
    logger.debug('add_recording: recording_id=%d thumbnail', rec_id)
    _generate_recording_thumbnail(db, rec_id, ts_path, scan_fields, config, video_pid=video_pid)

    # ── eit_overlap 計算 ──────────────────────────────────────────────────
    # AR2 後に確定した eit_*_time / recording_*_time を使って重なり度合いを算出
    eit_start = scan_fields.get('eit_start_time') or recording.get('eit_start_time')
    eit_end   = scan_fields.get('eit_end_time')   or recording.get('eit_end_time')
    rec_start = scan_fields.get('recording_start_time')
    rec_end   = scan_fields.get('recording_end_time')
    overlap = _calc_overlap(eit_start, eit_end, rec_start, rec_end)
    if overlap is not None:
        db.update_recording(rec_id, eit_overlap=overlap)

    # ── コメント取得 ────────────────────────────────────────────────────────
    logger.debug('add_recording: recording_id=%d fetch_comments', rec_id)
    _fetch_and_store_comments(db, rec_id, sid, scan_fields)

    # ── フレーム表キャッシュの前生成(分割画面の厳密フレーム表示用) ─────────────
    # 初回アクセス時にTS全走査(数十秒)が走って Loading が長い/高負荷になるため、
    # 登録スキャン時に server/data/frame_index/ へ作っておく。失敗しても登録は継続
    # (H.264等の未対応TSは初回アクセス時に unsupported 判定される従来動作のまま)
    try:
        from media.frame_index.cache import get_or_build_frame_table
        from media.frame_index.table_file import frame_index_path
        data_dir = data_paths.DATA_DIR
        get_or_build_frame_table(ts_path, frame_index_path(rec_id, data_dir))
        logger.debug('add_recording: recording_id=%d frame_index cache 生成', rec_id)
    except Exception as e:
        logger.info('add_recording: recording_id=%d frame_index 生成スキップ: %s', rec_id, e)

    # ── CMカット解析(分割画面のシークバーに出す) ─────────────────────────────
    # 1本あたり数分・4コアを使い切るので、既にあるものは作り直さない。
    # 失敗しても登録は継続する（局の設定が無い/ロゴが無い等で普通に失敗する）
    try:
        # 解析中に録画を消された・解析中止なら途中で止める（1本数分・4コアを使い切るため）
        if _analyze_cm(db, rec_id, ts_path, config, logger, abort=gone):
            db.update_recording(rec_id, cm_error=None)
    except _CmAborted:
        # 消された・解析中止。失敗ではないので理由は残さない
        logger.info('add_recording: recording_id=%d CM解析を途中で止めた（削除・解析中止）', rec_id)
    except Exception as e:
        logger.info('add_recording: recording_id=%d CM解析スキップ: %s', rec_id, e)
        # 理由を残す。error_message は使えない（あれを立てると一覧で録画自体が
        # エラー表示になる。録画は成功している）。ログだけだと再起動で消えて
        # 「なぜ解析されていないのか」が後から辿れない
        try:
            db.update_recording(rec_id, cm_error=f'{type(e).__name__}: {e}'[:500])
        except Exception:
            pass


def _update_segments(db, rec_id, recording, ep_num_list, ep_name_list, ep_count):
    """話ごとの区間(segments)を計算して保存する。

    max(episode_number件数, episode_name件数) が1以上 かつ duration/recording_*_time/eit_*_time あり。
    null または話数変化時のみ再計算。
    """
    dur       = recording.get('duration_sec')
    rec_start = recording.get('recording_start_time')
    eit_start = recording.get('eit_start_time')
    eit_end   = recording.get('eit_end_time')
    logger.debug('add_recording: recording_id=%d eit_start=%s rec_start=%s dur=%s', rec_id, eit_start, rec_start, dur)
    if not (dur is not None or rec_start or eit_start):
        logger.warning('add_recording: recording_id=%d segments skip (no time info)', rec_id)
        return
    existing_raw = recording.get('segments')
    try:
        existing_segs = json.loads(existing_raw) if existing_raw else None
    except Exception:
        existing_segs = None
    existing_count = len(existing_segs) if existing_segs else 0
    if existing_segs is not None and existing_count == ep_count:
        logger.info('add_recording: recording_id=%d segments skip (existing %d == ep_count %d)', rec_id, existing_count, ep_count)
        return
    segs = None
    if recording.get('addon'):
        # 取り込みは CM を捨てて録るので中身が枠より短く、枠を
        # 話数で割る計算が合わない。実際の話の長さはアドオンが知っている
        try:
            from logic.addons import addon_runner
            segs = addon_runner.recording_segments(recording, ep_count, dur)
        except Exception as e:
            logger.warning('add_recording: recording_id=%d アドオンの区間取得に失敗(無視): %s',
                           rec_id, e)
            segs = None
    if not segs:
        segs = calculate_segments(
            eit_start, eit_end,
            ep_count,
            rec_start_time=rec_start,
            file_duration_sec=dur,
        )
    logger.debug('add_recording: recording_id=%d segments calculated: %s', rec_id, segs)
    if not segs:
        logger.warning('add_recording: recording_id=%d segments calc returned empty', rec_id)
        return
    try:
        segs = mark_registered_segments_skip(
            segs, _get_video_db(), recording.get('sid'),
            recording.get('folder'), recording.get('title'),
            ep_num_list, ep_name_list,
            categories=recording.get('category'))
    except Exception as e:
        logger.warning('add_recording: recording_id=%d SKIP mark failed: %s', rec_id, e)
    db.update_recording(rec_id, segments=json.dumps(segs, ensure_ascii=False))
    logger.debug('add_recording: recording_id=%d segments saved (%d segs): %s', rec_id, len(segs), segs)


def _update_duplicate_info(db, rec_id, recording, ep_num_list, ep_name_list):
    """既存video(video.db)との重複情報を保存（録画一覧カード/録画詳細の重複表示用）。"""
    try:
        from logic.recordings.duplicates import build_duplicate_info
        dups = build_duplicate_info(_get_video_db(), recording.get('folder'),
                                    recording.get('title'), ep_num_list, ep_name_list)
        db.update_recording(rec_id, duplicate_info=json.dumps(dups, ensure_ascii=False))
    except Exception as e:
        logger.warning('add_recording: recording_id=%d duplicate_info failed: %s', rec_id, e)
