"""tag.json の読み書き"""

import json
import os
from .common import (  # noqa: F401
    logger,
)


# ---------------------------------------------------------------------------
# tag.json
# ---------------------------------------------------------------------------

def _write_tag_json(tag_path: str, recording: dict, idx: int) -> None:
    """recordings レコードから tag.json を初期生成する。"""
    EXCLUDE = {
        'shimakaze_job_id', 'output_path', 'amatsukaze_ts_path',
        'konomitv_ts_path', 'edcb_ts_path', 'auto_send', 'else_info', 'eit_overlap',
        'key_frames',  # 大きいので tag.json には書かない
        # CMカット解析は**元TSの時間軸**の位置なので生では持たせない。
        # 代わりに放送の実時刻(TOT)へ直したものを cm_marks として入れる(下)
        'cm_analysis',
    }
    # text_parser_result は複数話のまま保持する（縮約は表示/適用側で episode_idx を使う）
    # video は単話なので title/folder/furigana/setting も idx で単話へ縮約する（video_db は文字列を要求）。
    LIST_COLS = {'title', 'folder', 'furigana', 'setting',
                 'episode_number', 'episode_name', 'segments', 'app_output_path'}

    tag = {}
    for k, v in recording.items():
        if k in EXCLUDE:
            continue
        if k in LIST_COLS and isinstance(v, list):
            v = v[idx] if idx < len(v) else (v[0] if v else None)
        if k == 'category' and v is not None and not isinstance(v, list):
            v = [v]
        tag[k] = v
    # 何話目か（複数話のリスト縮約に使う）を明示的に保存
    tag['episode_idx'] = idx
    marks = _cm_marks_from_analysis(recording.get('cm_analysis'))
    if marks:
        tag['cm_marks'] = marks

    os.makedirs(os.path.dirname(tag_path), exist_ok=True)
    with open(tag_path, 'w', encoding='utf-8') as f:
        json.dump(tag, f, ensure_ascii=False, indent=2, default=str)


def _cm_marks_from_analysis(raw):
    """cm_analysis(元TSの時間軸) から、放送の実時刻(TOT)だけの控えを作る。

    tag.json が指すのはトリム・分割(と CM カット)を通したあとの動画なので、
    「先頭から何秒」は持ち越せない。**放送の実時刻なら動かない**ので、
    無音区間・シーンチェンジ・構成の区切りを TOT で残しておく。
    出力動画側の実時刻対応(get_trim_segments が返す TOT)と突き合わせれば、
    あとから位置を復元できる。

    秒やフレーム番号は意図的に落とす。残すと元TSの数字を出力動画のものと
    取り違えるため。
    """
    if not raw:
        return None
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None
    mutes = [{'tot': m['tot'], 'dur': round(m['end'] - m['start'], 3)}
             for m in (d.get('mutes') or []) if m.get('tot')]
    scenes = [{'tot': sc['tot'], 'mark': sc.get('mark') or ''}
              for sc in (d.get('scenes') or []) if sc.get('tot')]
    jls = [{'start_tot': g['start_tot'], 'end_tot': g['end_tot'], 'label': g.get('label')}
           for g in (d.get('jls_segments') or []) if g.get('start_tot')]
    trim = [{'start_tot': t['start_tot'], 'end_tot': t['end_tot']}
            for t in (d.get('trim_segments') or []) if t.get('start_tot')]
    if not (mutes or scenes or jls or trim):
        return None
    return {
        'version': 1,
        'base': 'tot',                  # 位置は放送の実時刻(JST)。秒やフレームではない
        'analyzed_at': d.get('analyzed_at'),
        'jl': d.get('jl'),
        'logos': d.get('logos'),
        'mutes': mutes,
        'scenes': scenes,
        'jls_segments': jls,
        'trim_segments': trim,
    }


def _caption_count(captions_json) -> int:
    """字幕 JSON の件数を返す（壊れていれば 0）。"""
    if not captions_json:
        return 0
    try:
        data = json.loads(captions_json) if isinstance(captions_json, str) else captions_json
    except (json.JSONDecodeError, TypeError):
        return 0
    return len((data or {}).get('captions') or [])


def _update_tag_json(tag_path: str, trim_segments: list[dict],
                     comments_json: str, captions_json: str, captions2_json: str,
                     drop_error: str = None, *,
                     video_info: dict = None, audio_info: list = None,
                     file_size: int = None, duration_sec: float = None,
                     thumbnail_path: str = None, thumbnail_tile_path: str = None,
                     thumbnail_info: dict = None,
                     chapter_txt: str = None,
                     announce: str = None,
                     frame_table: dict = None,
                     src_captions_json: str = None,
                     src_captions2_json: str = None) -> None:
    """TOT トリム後に tag.json を更新する。"""
    _TAIL_KEYS = ('comments_json', 'captions_json', 'captions2_json', 'drop_error',
                  'backup_captions')

    with open(tag_path, encoding='utf-8') as f:
        existing = json.load(f)

    # version 先頭、長いデータは末尾に回す
    tag = {'version': '2.0'}
    for k, v in existing.items():
        if k not in _TAIL_KEYS and k != 'version':
            tag[k] = v

    tag['trim_segments'] = trim_segments
    if trim_segments:
        tag['recording_start_time'] = trim_segments[0].get('start')
        tag['recording_end_time']   = trim_segments[-1].get('end')
    if video_info is not None:
        tag['video_info'] = video_info
    if audio_info is not None:
        tag['audio_info'] = audio_info
    if file_size is not None:
        tag['file_size'] = file_size
    if duration_sec is not None:
        tag['duration_sec'] = duration_sec
    if thumbnail_path is not None:
        tag['thumbnail_path'] = thumbnail_path
    if thumbnail_tile_path is not None:
        tag['thumbnail_tile_path'] = thumbnail_tile_path
    if thumbnail_info is not None:
        tag['thumbnail_info'] = thumbnail_info
    if chapter_txt is not None:
        tag['chapter_txt'] = chapter_txt
    if announce is not None:
        tag['announce'] = announce
    # コマ送り用のフレーム表(表示時刻の一覧)。数KBあるので長いデータの手前に置く。
    if frame_table is not None:
        tag['frame_table'] = frame_table

    # comment_count は長いデータの前に配置
    comments_parsed = json.loads(comments_json) if comments_json else None
    if isinstance(comments_parsed, dict):
        tag['comment_count'] = len(comments_parsed.get('comments', []))

    # 長いデータを末尾に配置
    tag['comments_json']  = comments_parsed
    tag['captions_json']  = json.loads(captions_json)  if captions_json  else None
    tag['captions2_json'] = json.loads(captions2_json) if captions2_json else None

    # 字幕付き([字])なのにトリムで全件消えた = 区間の時刻が壊れている疑い。
    # 録画時点の字幕は tag.json にしか残せないので、退避しておく（TSを消した後でも
    # 時刻さえ直せば復元できるようにする）
    if '[字' in str(existing.get('setting') or ''):
        backup = existing.get('backup_captions') or {}
        for key, trimmed, src in (('captions_json',  captions_json,  src_captions_json),
                                  ('captions2_json', captions2_json, src_captions2_json)):
            if _caption_count(src) and not _caption_count(trimmed):
                backup[key] = json.loads(src) if isinstance(src, str) else src
                logger.warning('_update_tag_json: トリムで字幕が全部消えたため録画時の字幕'
                               '(%s %d件)を backup_captions へ退避しました: %s',
                               key, _caption_count(src), tag_path)
        if backup:
            tag['backup_captions'] = backup
    if drop_error:
        try:
            tag['drop_error'] = json.loads(drop_error) if isinstance(drop_error, str) else drop_error
        except (json.JSONDecodeError, TypeError):
            tag['drop_error'] = existing.get('drop_error')

    with open(tag_path, 'w', encoding='utf-8') as f:
        json.dump(tag, f, ensure_ascii=False, indent=2, default=str)
