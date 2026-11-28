"""録画の実況コメント（取って保存する・本編を差し替える・取り直す）"""

import json
from datetime import datetime as _dt
from .parse import logger


def _fetch_and_store_comments(db, rec_id: int, sid: int, scan_fields: dict) -> None:
    """sid と recording_*_time から実況コメントを取得して recordings に保存する。"""
    rec_start_str = scan_fields.get('recording_start_time')
    rec_end_str   = scan_fields.get('recording_end_time')
    if not (sid and rec_start_str and rec_end_str):
        return
    try:
        from read_tsprogram.comments import fetch_program_comments
        rec_start_dt = _dt.fromisoformat(rec_start_str)
        rec_end_dt   = _dt.fromisoformat(rec_end_str)
        comments_json = fetch_program_comments(sid, rec_start_dt, rec_end_dt)
        if comments_json is not None:
            import json as _j
            comment_count = len(_j.loads(comments_json).get('comments', []))
            db.update_recording(rec_id, comments_json=comments_json, comment_count=comment_count)
            logger.debug('add_recording: recording_id=%d comments OK (%d件)', rec_id, comment_count)
    except Exception as e:
        logger.warning('add_recording: recording_id=%d fetch_comments failed: %s', rec_id, e)


def replace_main_comments(comments_json, new_list: list):
    """保存してあるコメント（comments_json）の主トラックを new_list に入れ替える。件数が増える時だけ。

    追加トラック（comments 以外の名前のリスト）には手を付けない。古い保存（コメントの配列そのもの）は主トラックとみなす。
    録画と動画の取り直し（refetch_recording_comments / refetch_video_comments）が使う。
    戻り値: (入れ替えた後の dict。増えなければ None, 前の件数)
    """
    try:
        cur = json.loads(comments_json or '{}')
    except (ValueError, TypeError):
        cur = {}
    if isinstance(cur, list):
        cur = {'comments': cur}
    elif not isinstance(cur, dict):
        cur = {}
    before = len(cur.get('comments') or [])
    if len(new_list) <= before:
        return None, before
    cur['comments'] = new_list
    return cur, before


def refetch_recording_comments(db, rec_id: int):
    """録画の実況コメントを取り直し、件数が増えた時だけ主トラックを入れ替える。

    録画が終わった直後の取得は過去ログAPIが追いついておらず、終わり近くのコメントが欠ける
    （別のサーバーで : 335件→後で453件など、ほぼ全録画で1〜3割）。後から取り直して埋める。
    戻り値: {'updated', 'before', 'after'}（refetch_video_comments と同じ形）。取れなかった時は None
    """
    rec = db.get_recording(rec_id)
    if not rec or not rec.get('sid') or not rec.get('recording_start_time') or not rec.get('recording_end_time'):
        return None
    from read_tsprogram.comments import fetch_program_comments
    fetched = fetch_program_comments(rec['sid'], _dt.fromisoformat(rec['recording_start_time']),
                                     _dt.fromisoformat(rec['recording_end_time']))
    if fetched is None:
        return None
    new_list = (json.loads(fetched) or {}).get('comments') or []
    cur, before = replace_main_comments(rec.get('comments_json'), new_list)
    if cur is not None:
        db.update_recording(rec_id, comments_json=json.dumps(cur, ensure_ascii=False), comment_count=len(new_list))
    return {'updated': cur is not None, 'before': before, 'after': len(new_list)}
