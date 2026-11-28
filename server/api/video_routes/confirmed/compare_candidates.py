"""字幕・実況の取り込みで比べる相手の候補"""

import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.rec_aug_rows import _cv_str
from api.routes.media import _parse_captions_data
from api.routes.parser import trim_duration_gap


def _audio_compare_source_row(db, body):
    """比較相手の指定（video_id / recording_id / path）から (行, パス, source情報) を返す。

    path 直接指定でも、同じパスの video/recording があれば行を引き当てる
    （字幕/コメントの取り込みには元データが要るため）。
    """
    rule_db = current_app.config.get('RULE_DB')
    vid = body.get('video_id')
    if vid is not None:
        row = db.get_video_row(int(vid))
        if row is None:
            return None, None, None
        return row, row.get('file_path'), {'kind': 'video', 'video_id': int(vid),
                                           'path': row.get('file_path')}
    rid = body.get('recording_id')
    if rid is not None and rule_db is not None:
        rec = rule_db.get_recording(int(rid))
        if rec is None:
            return None, None, None
        path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
        return rec, path, {'kind': 'recording', 'recording_id': int(rid), 'path': path}

    path = (body.get('path') or '').strip()
    if not path:
        return None, None, None
    row = None
    vid2 = db.find_video_id_by_path(path)
    if vid2 is not None:
        row = db.get_video_row(vid2)
    elif rule_db is not None:
        row = rule_db.get_recording_by_host_path(path)
    return row, path, {'kind': 'path', 'path': path,
                       'video_id': vid2, 'recording_id': (row or {}).get('id') if vid2 is None else None}


@bp.get('/videos/<int:video_id>/audio-compare/candidates')
def audio_compare_candidates(video_id):
    """音声比較の相手候補（確定値が一致する video / recording）を返す。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404, description='動画が見つかりません')
    series = db.get_series_row(video['series_id']) if video.get('series_id') is not None else None
    album = db.get_album_row(series['album_id']) if series and series.get('album_id') is not None else None
    folder = album.get('name') if album else None
    title = series.get('name') if series else None
    en, nm = video.get('episode_number'), video.get('episode_name')

    videos = []
    for v in db.find_registered_episodes(folder, title, en, nm):
        if v['id'] == video_id:
            continue
        row = db.get_video_row(v['id']) or {}
        if not row.get('file_path') or not os.path.exists(row['file_path']):
            continue
        videos.append({
            'kind': 'video', 'id': v['id'], 'path': row.get('file_path'),
            'title': row.get('eit_title') or '', 'station': row.get('eit_station_name') or '',
            'episode_number': row.get('episode_number'), 'episode_name': row.get('episode_name'),
            'recording_start_time': row.get('recording_start_time'),
            'duration_sec': row.get('duration_sec'),
            # 中身が足りない相手（入力が既にCMカット済み等）。選ぶと取り込みが壊れるので画面で出す
            'duration_gap': trim_duration_gap(row),
            # captions_json は空({"captions":[]})でも文字列としては真になるため実体で見る
            'has_caption': len(_parse_captions_data(row.get('captions_json'))) > 0,
            'comment_count': int(row.get('comment_count') or 0),
        })

    recordings = []
    rule_db = current_app.config.get('RULE_DB')
    if rule_db is not None and (title or folder):
        def _cv(x):
            return _cv_str(x)
        for rec in rule_db.list_recordings():
            if _cv(rec.get('title')) != _cv(title) or _cv(rec.get('folder')) != _cv(folder):
                continue
            if _cv(rec.get('episode_number')) != _cv(en) or _cv(rec.get('episode_name')) != _cv(nm):
                continue
            path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
            if not path or not os.path.exists(path):
                continue
            full = rule_db.get_recording(rec['id']) or rec
            recordings.append({
                'kind': 'recording', 'id': rec['id'], 'path': path,
                'title': rec.get('eit_title') or '', 'station': rec.get('eit_station_name') or '',
                'episode_number': rec.get('episode_number'), 'episode_name': rec.get('episode_name'),
                'recording_start_time': rec.get('recording_start_time'),
                'duration_sec': rec.get('duration_sec'),
                'has_caption': len(_parse_captions_data(full.get('captions_json'))) > 0,
                'comment_count': int(full.get('comment_count') or 0),
            })

    # 利用者ごとの権限（局・有料の番組）で、見てはいけない相手は出さない
    from api.routes.auth import perm
    from api.video_routes.library.perms import _perm_visible_videos
    p = perm()
    videos = _perm_visible_videos(videos)
    recordings = [r for r in recordings
                  if p.program((rule_db.get_recording(r['id']) or {}).get('is_paid'), *_rec_service(rule_db, r['id']))]
    return jsonify({'videos': videos, 'recordings': recordings})


def _rec_service(rule_db, rec_id):
    rec = rule_db.get_recording(rec_id) or {}
    return rec.get('onid'), rec.get('tsid'), rec.get('sid')
