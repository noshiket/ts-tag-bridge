"""録画登録の走査（番組情報）"""

from read_tsprogram import scanner as ts_scanner
from .parse import logger


def default_offset_sec(db, recording) -> int:
    """頭から読んで時刻で当てる時の、録画の最初からずらす秒数（予約の開始マージン + 15 秒）"""
    program = db.get_rule(recording['program_id']) if recording.get('program_id') else None
    start_margin = program.get('start_margin') if program else None
    return (start_margin or 0) + 15


def _scan_program_info(db, rec_id, recording, ts_path, scan_fields, error_reasons, program=None):
    """番組情報（EIT か scan アドオン）を読んで scan_fields に入れる。(ts_result, sid) を返す。

    program: ファイル全体を読む走査（ドロップ・字幕・キーフレーム）で一緒に集めた番組情報。
    録画の大部分で放送中だった番組なので、開始マージンの長さや開始の遅れに左右されない。
    あればそれを使い、無ければ（走査の失敗・p/f の無い TS）頭から読んで時刻で当てる。
    """
    logger.debug('add_recording: recording_id=%d [6/6] scan_ts', rec_id)
    sid = recording.get('sid') or 0
    offset_sec = default_offset_sec(db, recording)
    ts_result = None

    # 番組情報の在り処はソースによって違う。放送は EIT だが、それ以外を
    # 取り込んだ録画は別の持ち方をしていることがある。まず target='scan' の
    # アドオンに聞き、誰も出せなければ従来どおり EIT を読む
    try:
        from logic.addons import addon_runner
        ts_result = addon_runner.run_scan(recording, ts_path)
    except Exception as e:
        logger.warning('add_recording: recording_id=%d scan アドオンの呼び出しに失敗: %s',
                       rec_id, e)
    if ts_result:
        logger.info('add_recording: recording_id=%d 番組情報はアドオンから取りました', rec_id)

    if ts_result is None and program:
        ts_result = program
        logger.debug('add_recording: recording_id=%d 番組情報は全体の走査で集めた物 (eid=%s)',
                     rec_id, program.get('event_id'))

    try:
        if ts_result is None:
            ts_result = ts_scanner.scan_ts(ts_path, target_sid=sid or None,
                                           offset_sec=offset_sec)
    except ts_scanner.NoProgramInfo as e:
        # 番組情報がそもそも無い TS は「失敗」ではなく「対象なし」。配信を
        # 取り込んだものが該当する。error にすると後続(サムネイル/text_parser)
        # まで飛ばされて state='error' で終わるので、飛ばして続ける
        logger.info('add_recording: recording_id=%d EITスキャンをスキップ: %s', rec_id, e)
        # この録画を作ったアドオンに知らせる。放送用の EIT が無い代わりに何を
        # するかは、その録画を作った側が決める（コアは事実を流すだけ）
        try:
            from logic.addons import addon_events
            addon_events.emit('recording.scan_skipped', {
                'recording_id': rec_id,
                'program_id': recording.get('program_id'),
                'addon': recording.get('addon'),
                'sid': recording.get('sid'),
                'ts_path': ts_path,
                'reason': str(e),
            })
        except Exception:
            pass
    except Exception as e:
        logger.warning('add_recording: recording_id=%d scan_ts failed: %s', rec_id, e)
        error_reasons.append(f'EIT解析に失敗: {type(e).__name__}: {e}')

    if ts_result:
        sid = _apply_ts_result(rec_id, recording, ts_result, scan_fields, sid)
    return ts_result, sid


def _apply_ts_result(rec_id, recording, ts_result, scan_fields, sid):
    """TS から読んだ番組情報を scan_fields に入れる。sid を返す（録画に無ければ TS の値）。"""
    # 予約(EDCB の EPG)から写した番組名を残し、TS から読んだ番組名と違えば記録する。
    # 録画側(TS)が正で、eit_title はこの後 TS の値で上書きされる。差が文字の種類だけ
    # (全角/半角 等)なら予約時の正規化で揃えられ、中身の違いなら予約時の EPG が
    # 暫定だったことが分かる。やり直し(再スキャン)では最初に残した値を守る
    edcb_title = recording.get('edcb_title') or recording.get('eit_title') or ''
    if edcb_title and not recording.get('edcb_title'):
        scan_fields['edcb_title'] = edcb_title
    ts_title = ts_result.get('title', '') or ''
    if edcb_title and ts_title and edcb_title != ts_title:
        logger.info('add_recording: recording_id=%d 番組名が EDCB と TS で違う: %r → %r',
                    rec_id, edcb_title, ts_title)
    scan_fields.update({
        'eit_title':         ts_result.get('title', ''),
        'eit_description':   ts_result.get('description', ''),
        'eit_extended_info': ts_result.get('extended_info', ''),
        'eit_genre':         ts_result.get('genre', ''),
        'eit_video_info':    ts_result.get('video_info', ''),
        'eit_audio_info':    ts_result.get('audio_info', ''),
        'eit_station_name':  ts_result.get('service_name', ''),
    })
    # 有料の番組か（TS の番組情報の free_CA_mode。True=無料）。分からなければ書かない
    if ts_result.get('free_ca') is not None:
        scan_fields['is_paid'] = 0 if ts_result['free_ca'] else 1
    # eit_start/end_time: 録画の見張り(手順1)で保存済みの時刻を優先、NULL の場合のみ TS 値で補完
    if not recording.get('eit_start_time') and ts_result.get('start_time'):
        scan_fields['eit_start_time'] = ts_result['start_time']
    if not recording.get('eit_end_time') and ts_result.get('end_time'):
        scan_fields['eit_end_time'] = ts_result['end_time']
    # sid 未設定の場合は TS スキャン値で補完
    if not recording.get('sid'):
        scan_fields.update({
            'onid': ts_result.get('nid'),
            'tsid': ts_result.get('tsid'),
            'sid':  ts_result.get('sid'),
            'eid':  ts_result.get('event_id'),
        })
        sid = ts_result.get('sid') or sid
    return sid
