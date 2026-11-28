"""動画・シリーズ・アルバムを消す（付属のファイルも）"""

import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _delete_thumbnail_files


# 動画本体(<stem>.mp4)と一緒に動かす/消す付随ファイルの接尾辞。
# .cover.* は音楽のジャケット原本（再生用MP4の中の絵は 16:9 に合成したものなので、
# 原寸の画像はこのファイルにしか残らない）。
# .src.* は音楽の可逆の控え（再生用MP4 の音声は AAC で非可逆なので、原本を消したら
# ここからしか元の音に戻せない）。拡張子は元の形式によって変わる。
_SIDE_SUFFIXES = ('.thumbnail.webp', '.thumbnail_tile.webp',
                  '.cover.jpg', '.cover.png', '.cover.bmp',
                  '.audioviz.bin')


def _side_files(stem: str) -> list:
    """<stem> に付随するファイル（サムネ・ジャケット・可逆の控え）の実在パス。"""
    out = [stem + suf for suf in _SIDE_SUFFIXES if os.path.exists(stem + suf)]
    d, base = os.path.dirname(stem), os.path.basename(stem) + '.src.'
    if d and os.path.isdir(d):
        out += [os.path.join(d, n) for n in os.listdir(d) if n.startswith(base)]
    return out


def _delete_video_files(video: dict):
    """ライブラリ動画の物理ファイル（MP4本体 + tag.json + サムネ2種）を削除する。
    キャプチャ画像は対象外（残す）。"""
    import os
    fp = video.get('file_path') or ''
    for p in ([fp, fp + '.tag.json'] if fp else []):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass
    _delete_thumbnail_files(video.get('thumbnail_path'), video.get('thumbnail_tile_path'))
    # 音楽のジャケット原本と可逆の控え（変換元 source_path の原本は消さない）
    for p in (_side_files(os.path.splitext(fp)[0]) if fp else []):
        try:
            os.remove(p)
        except Exception:
            pass


@bp.delete('/videos/<int:video_id>')
def delete_video(video_id):
    """ライブラリ動画を恒久削除する。MP4・tag.json・サムネを削除し、video.db 行と
    配下0件になった series/album も連動削除する（captures は ON DELETE SET NULL で残す）。
    出力ディスクがオフライン時は 409 で拒否する。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404, description='動画が見つかりません')
    # 出力ディスクがオフライン（取り外し中）なら誤削除・孤児化防止のため拒否
    from logic.storage.disk_guard import is_disk_online
    fp = video.get('file_path') or ''
    if fp and not is_disk_online(fp):
        abort(409, description='出力ディスクがオフラインのため削除できません')
    _delete_video_files(video)
    db.delete_video(video_id)   # DB行 + 空 series/album 連動削除（captures は FK で NULL 化）
    return jsonify({'deleted': True, 'video_id': video_id})


def _purge_videos(rows, label: str) -> dict:
    """動画をまとめて恒久削除する（実ファイル + DB行 + 空になったフォルダ）。

    アルバム削除・シリーズ(音楽のアルバム)削除の共通処理。1本ずつの削除と同じ経路
    (_delete_video_files + delete_video)を通すので、tag.json・サムネの後始末や
    series/album の連動削除の扱いも同じになる。
    """
    import os

    from logic.storage.disk_guard import is_disk_online
    rows = [r for r in rows if r]
    # 1本でもオフラインのディスク上にあるなら、部分削除で中途半端に壊さないよう全体を拒否する
    for r in rows:
        fp = r.get('file_path') or ''
        if fp and not is_disk_online(fp):
            abort(409, description='出力ディスクがオフラインのため削除できません')

    dirs = set()
    deleted = 0
    for r in rows:
        fp = r.get('file_path') or ''
        if fp:
            dirs.add(os.path.dirname(fp))
        _delete_video_files(r)
        db = current_app.config['VIDEO_DB']
        db.delete_video(r['id'])
        deleted += 1

    # 動画が全部消えて空になったフォルダだけ畳む。他のファイルが残っていれば触らない
    removed_dirs = []
    for d in sorted(dirs, key=len, reverse=True):
        try:
            if d and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
                removed_dirs.append(d)
        except OSError:
            pass
    return {'deleted': deleted, 'removed_dirs': removed_dirs}


@bp.delete('/videos/series/<int:series_id>')
def delete_video_series(series_id):
    """series 配下の動画をまとめて恒久削除する（音楽のアルバム削除に使う）。

    音楽は album=アーティスト / series=アルバム / video=曲 なので、「アルバムを削除」は
    このシリーズ削除にあたる。中身が無くなった series/album は delete_video の
    連動削除で片付く。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    series = db.get_series_row(series_id)
    if series is None:
        abort(404, description='シリーズが見つかりません')
    detail = db.get_series_videos(series_id)
    videos = (detail or {}).get('videos') or []
    rows = [db.get_video_row(v['id']) for v in videos]
    res = _purge_videos(rows, 'series')
    return jsonify({**res, 'series_id': series_id, 'name': series.get('name')})


@bp.delete('/videos/albums/<int:album_id>')
def delete_video_album(album_id):
    """album 配下の動画をまとめて恒久削除する（DB行 + 実ファイル + 空になったフォルダ）。

    text_parser の誤爆で勝手に作られたフォルダ（'TestFolder' や '{$folder}' 等）を
    片付けるためのもの。1本ずつの削除と同じ経路(_delete_video_files + delete_video)を
    通すので、tag.json・サムネの後始末や series/album の連動削除の扱いも同じになる。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    # 削除は実体を消す操作なので、非公開のものも含めて対象にする
    detail = db.get_album_detail(album_id)
    if detail is None:
        abort(404, description='アルバムが見つかりません')
    videos = [v for s in detail.get('series', []) for v in s.get('videos', [])]
    res = _purge_videos([db.get_video_row(v['id']) for v in videos], 'album')
    return jsonify({**res, 'album_id': album_id})
