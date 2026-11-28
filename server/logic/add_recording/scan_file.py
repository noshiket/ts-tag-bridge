"""録画登録の走査（ファイルがあるか・ファイルの情報・ドロップと字幕）"""

import json
import os
from datetime import datetime as _dt
from media.probe import ffprobe
from read_tsprogram import scanner as ts_scanner
from read_tsprogram import ScanAborted as _ScanAborted
from .parse import logger


def _check_file_exists(db, rec_id, recording, ts_path) -> bool:
    """TS が無ければ non_file にする（手動登録なら行ごと消す）。続けてよければ True。"""
    if ts_path and os.path.exists(ts_path):
        return True
    # 手動登録（EDCB管理外）はファイル消失＝実体なしなのでエントリごと自動削除する
    if recording.get('rec_id') is None and recording.get('program_id') is None:
        db.delete_recording(rec_id)
        logger.info('add_recording: recording_id=%d 手動登録のTS消失 → 自動削除 (%s)',
                    rec_id, ts_path)
        return False
    db.update_recording(rec_id, state='non_file', file_exist=0)
    logger.info('add_recording: recording_id=%d → non_file (%s)', rec_id, ts_path)
    return False


def _scan_file_info(rec_id, recording, ts_path, config, scan_fields, error_reasons):
    """大きさ・長さ・映像/音声の情報・フレーム表・録画時刻(TOT)を scan_fields に入れる。"""
    # file_size (失敗しても state=error にしない)
    logger.debug('add_recording: recording_id=%d [1/6] file_size', rec_id)
    try:
        scan_fields['file_size'] = os.path.getsize(ts_path)
    except Exception as e:
        logger.warning('add_recording: recording_id=%d getsize failed: %s', rec_id, e)

    # ffprobe — duration_sec + probe_result（映像/音声情報 + 副音声検出用の音声本数）
    logger.debug('add_recording: recording_id=%d [2/6] ffprobe', rec_id)
    _ffprobe = config.get('ffprobe', 'ffprobe')
    duration_sec = ffprobe.get_duration(_ffprobe, ts_path)
    if duration_sec is None:
        # 全トランスポンダ捕捉(多プログラム)等では ffprobe が format.duration=N/A を返す。
        # ここでは error にせず、後段の録画時刻(TOT)から尺を補完する。
        logger.warning('add_recording: recording_id=%d duration NULL (ffprobe失敗、TOTから補完を試みる)', rec_id)
    else:
        scan_fields['duration_sec'] = duration_sec

    # probe_result: 映像/音声情報を保存。副音声(解説放送/二カ国語)は通常 probe で取りこぼすため、
    # サービス内の音声本数を深い解析で数えて audio_stream_count に保存する（再生プレイヤーの副音声判定用）。
    try:
        info = ffprobe.get_video_info(_ffprobe, ts_path) or {}
        n_audio = ffprobe.count_audio_streams(_ffprobe, ts_path, service_id=recording.get('sid'))
        if n_audio is not None:
            info['audio_stream_count'] = n_audio
        if info:
            scan_fields['probe_result'] = json.dumps(info, ensure_ascii=False)
    except Exception as e:
        logger.warning('add_recording: recording_id=%d probe_result failed: %s', rec_id, e)

    # frame_table: コマ送り用のフレーム表(表示時刻の一覧)。
    # MPEG-2 は media/frame_index.py が Amatsukaze の Trim(n) と一致する厳密な表を
    # 作れる(カットにも使う)のでそちらに任せ、自前パーサが対応していない
    # H.264/H.265 のときだけ ffprobe で作る。用途は表示・コマ送り・シークのみで、
    # プルダウン展開の有無が Amatsukaze と一致する保証がないためカットには使わない。
    try:
        codec = ((json.loads(scan_fields['probe_result']).get('video') or {}).get('codec')
                 if scan_fields.get('probe_result') else None)
        if codec in ('h264', 'hevc', 'h265'):
            from media import mp4_frames
            table = mp4_frames.build(ts_path, _ffprobe)
            if table:
                scan_fields['frame_table'] = json.dumps(table, ensure_ascii=False)
                logger.info('add_recording: recording_id=%d フレーム表(%s) %s',
                            rec_id, codec, mp4_frames.summary(table))
    except Exception as e:
        logger.warning('add_recording: recording_id=%d フレーム表の生成に失敗(無視): %s', rec_id, e)

    # TOT — recording_start_time / recording_end_time
    logger.debug('add_recording: recording_id=%d [3/6] get_recording_times', rec_id)
    try:
        scan_fields.update(ts_scanner.get_recording_times(ts_path))
    except Exception as e:
        logger.warning('add_recording: recording_id=%d get_recording_times failed: %s', rec_id, e)
        error_reasons.append(f'録画時刻の取得に失敗: {type(e).__name__}: {e}')

    # ffprobe が duration を取れなかった場合(多プログラムTS等)は録画時刻(TOT)から補完する
    if 'duration_sec' not in scan_fields:
        _rs, _re = scan_fields.get('recording_start_time'), scan_fields.get('recording_end_time')
        if _rs and _re:
            try:
                _d = (_dt.fromisoformat(_re) - _dt.fromisoformat(_rs)).total_seconds()
                if _d > 0:
                    scan_fields['duration_sec'] = _d
                    logger.info('add_recording: recording_id=%d duration をTOTから補完: %.1fs', rec_id, _d)
            except Exception as e:
                logger.warning('add_recording: recording_id=%d TOTからの duration 補完失敗: %s', rec_id, e)
        if 'duration_sec' not in scan_fields:
            logger.warning('add_recording: recording_id=%d duration を取得できず(ffprobe/TOTとも失敗)', rec_id)


def _scan_drops_captions(rec_id, recording, ts_path, gone, scan_fields, error_reasons):
    """drop check + 字幕抽出（key_frames 含め全走査1回に統合。字幕失敗は state=error にしない）。

    (多プログラムTSで選んだ対象の映像PID（サムネ生成で同じストリームを見る）,
     録画の大部分で放送中だった番組の情報（同じ走査で集めた物。取れなければ None）) を返す。
    走査中に消されたら ScanAborted がそのまま上がる。
    """
    logger.debug('add_recording: recording_id=%d [4/6][5/6] scan_drops_captions_key_frames', rec_id)
    video_pid = None
    program = None
    try:
        merged = ts_scanner.scan_drops_captions_key_frames(
            ts_path, abort_cb=gone, preferred_sid=recording.get('sid'))
        video_pid = merged.get('video_pid')
        program = merged.get('program')
        scan_fields['drop_error'] = merged['drop_error']
        scan_fields['key_frames'] = json.dumps(merged['key_frames'], ensure_ascii=False)
        if merged.get('captions_json'):
            scan_fields['captions_json'] = merged['captions_json']
        if merged.get('captions2_json'):
            scan_fields['captions2_json'] = merged['captions2_json']
    except _ScanAborted:
        raise
    except Exception as e:
        logger.warning('add_recording: recording_id=%d scan_drops_captions_key_frames failed: %s', rec_id, e)
        error_reasons.append(f'ドロップ/字幕/キーフレームの走査に失敗: {type(e).__name__}: {e}')
    return video_pid, program
