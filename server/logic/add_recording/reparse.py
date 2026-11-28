"""録画の番組情報を解析し直す（規制で待たせた分・TS から読み直す）"""
from .parse import _apply_text_parser, logger

def retry_rate_limited(db, rec_id: int, config: dict, parser_store) -> bool:
    """規制中に飛ばした text_parser をやり直す。番組情報は録画に残っている TS の値を使う。

    やり直せた（規制の印が外れた）なら True。規制中でも試し、問い合わせが要ればまた後回しで False。
    """
    from text_parser.shoboi_api import has_rate_limited_error
    rec = db.get_recording(rec_id)
    if not rec or not has_rate_limited_error(rec.get('parser_error')):
        return False
    return reparse_from_ts(db, rec_id, config, parser_store)


def reparse_from_ts(db, rec_id: int, config: dict, parser_store) -> bool:
    """録画に残っている TS の番組情報で text_parser をやり直す。規制の印が無くなれば True。"""
    from text_parser.shoboi_api import has_rate_limited_error
    rec = db.get_recording(rec_id)
    if not rec:
        return False
    ts_result = {
        'title': rec.get('eit_title') or '', 'description': rec.get('eit_description') or '',
        'extended_info': rec.get('eit_extended_info') or '',
        'service_name': rec.get('eit_station_name') or '', 'start_time': rec.get('eit_start_time') or '',
        'nid': rec.get('onid'), 'tsid': rec.get('tsid'), 'sid': rec.get('sid'),
    }
    rec = _apply_text_parser(db, rec_id, ts_result, rec.get('sid') or 0, config, parser_store)
    done = bool(rec) and not has_rate_limited_error(rec.get('parser_error'))
    logger.info('add_recording: recording_id=%d 規制で飛ばした text_parser をやり直し → %s',
                rec_id, '済' if done else 'まだ')
    return done
