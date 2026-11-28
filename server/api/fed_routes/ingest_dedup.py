"""受け取った動画の重複の片付けと、録画の情報の残り"""

import json
from typing import Optional
from .common import logger


def _drop_count(drop_error) -> Optional[int]:
    """drop_error(JSON文字列 or parse済みdict)から drop_count を取り出す。取れなければ None。"""
    if isinstance(drop_error, str):
        try:
            drop_error = json.loads(drop_error)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(drop_error, dict):
        return None
    v = drop_error.get('drop_count')
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return int(v)


def _dedup_master_duplicates(rule_db, tag: dict) -> None:
    """地域によるドロップ対策で同一番組をマスター/スレーブ双方で録画している場合、
    push受信を機にマスター側の重複録画を削除する。

    同一判定: onid/tsid/sid/eid + eit_start_time の完全一致。
    削除条件: マスター側の drop_count がスレーブ側(pushされたtag)以上（同等含む。
    スレーブ側のエンコード成果物が今まさに登録されたので、品質が同等以下の
    マスター側TSを持ち続ける意味がない）。
    温存条件: マスター側に encodings が存在する（エンコード済み/エンコード中は消さない）、
    drop_error が欠落して比較できない、マスター側の方が低ドロップ、ディスク未マウント。
    削除内容: TS等ファイル(_delete_recording_files) + ignore_rec_id(B-0再取込防止) +
    recordings行(delete_recordingの孤児判定で親programも消える)。
    """
    keys = ('onid', 'tsid', 'sid', 'eid', 'eit_start_time')
    vals = [tag.get(k) for k in keys]
    if any(v in (None, '') for v in vals):
        return
    slave_drop = _drop_count(tag.get('drop_error'))
    if slave_drop is None:
        return
    from logic.encoding.encode_history import _delete_recording_files
    for rec in rule_db.find_recordings_by_event(*vals):
        rec_db_id = rec['id']
        try:
            if rule_db.get_encodings(rec_db_id):
                logger.info('fed dedup: recordings.id=%d はencodingsありのため温存', rec_db_id)
                continue
            master_drop = _drop_count(rec.get('drop_error'))
            if master_drop is None:
                logger.info('fed dedup: recordings.id=%d drop_error比較不能のためスキップ', rec_db_id)
                continue
            if master_drop < slave_drop:
                logger.info('fed dedup: recordings.id=%d 温存（マスター側が低ドロップ: %d < %d）',
                            rec_db_id, master_drop, slave_drop)
                continue
            ts_path = rec.get('host_ts_path') or ''
            if ts_path and rule_db.disk_offline(ts_path):
                logger.info('fed dedup: recordings.id=%d ディスク未マウントのためスキップ', rec_db_id)
                continue
            _delete_recording_files(rec)
            if rec.get('rec_id') is not None:
                rule_db.ignore_rec_id(rec['rec_id'])
            rule_db.delete_recording(rec_db_id)
            logger.info('fed dedup: マスター側の重複録画 recordings.id=%d を削除（drop %d >= slave %d）',
                        rec_db_id, master_drop, slave_drop)
        except Exception as e:
            logger.warning('fed dedup: recordings.id=%s の処理に失敗: %s', rec_db_id, e)


def _meta_rest(rule_db, meta: dict) -> dict:
    """転送されてきた meta のうち、そのまま recordings へ入れてよい列。

    受け側が自分で決める列（state や実体のパス、この行で明示的に設定するもの）を
    除き、残りを返す。列が増えても勝手に付いてくるようにするため、個別列挙では
    なく「除外」で書く。

    get_recording は JSON 列を dict/list に解いて返すので、そのまま渡すと sqlite が
    "type 'dict' is not supported" で落ちる。rule_db が自前で畳む列以外は文字列へ戻す。
    """
    from db.rule_db.common import _LIST_COLS

    decided = {
        'state', 'file_exist', 'segments', 'to_encode_info', 'encode_dir',
        'comments_json', 'captions_json', 'captions2_json', 'key_frames',
        'onid', 'tsid', 'sid', 'eid', 'server_url',
        'eit_title', 'eit_description', 'eit_extended_info', 'eit_station_name',
        'eit_genre', 'eit_video_info', 'eit_audio_info',
        'eit_start_time', 'eit_end_time',
        'title', 'folder', 'episode_number', 'episode_name', 'category', 'furigana',
        'app_output_path', 'app_output_path_format',
        'file_size', 'duration_sec', 'drop_error',
        'recording_start_time', 'recording_end_time',
        # 転送用の付帯情報。列ではない
        'priority',
    }
    cols = rule_db.recording_columns()
    rest = {k: v for k, v in meta.items() if k in cols and k not in decided}
    folds_itself = set(_LIST_COLS) | {'parser_error'}
    for k, v in list(rest.items()):
        if isinstance(v, dict) or (isinstance(v, list) and k not in folds_itself):
            rest[k] = json.dumps(v, ensure_ascii=False)
    return rest
