"""動画フォルダの移動とシリーズの名前の付け替え"""

import os
import shutil
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag, _remap_watch_history_video, _save_tag  # noqa: F401
from ..library.deletion import _side_files  # noqa: F401


def _rename_video_series(db, video_id: int, new_title: str) -> dict:
    """1本の動画のシリーズ名(tag.json の title)を変える。ファイル名にも反映する。

    アルバム名はディレクトリだが、シリーズ名はファイル名の中に入っている
    （例 .../宇宙戦記ガイア/[BS98]宇宙戦記ガイア 孤島の戦い_20260830-1900.mp4）。
    そのため置き換えるのはファイル名だけで、ディレクトリは触らない。
    アルバム名とシリーズ名が同じ動画も多いので、ここを取り違えるとフォルダごと
    動かしてしまう。

    ファイル名にシリーズ名が入っていない（出力パスを手で変えた等）ときは、
    ファイルはそのままで tag.json と DB だけ書き換える。
    id は変わる（登録し直しになる）。
    """
    from logic.storage.mount_point import safe_makedirs
    from text_parser.paths import sanitize_path_component

    v = db.get_video_row(video_id)
    if v is None:
        return {'id': video_id, 'ok': False, 'error': '動画が見つかりません'}
    old_path = v.get('file_path') or ''
    tag = _load_tag(old_path + '.tag.json') if old_path else None
    if not old_path or tag is None:
        return {'id': video_id, 'ok': False, 'error': 'tag.json が見つかりません'}
    old_title = tag.get('title') or ''
    if old_title == new_title:
        return {'id': video_id, 'ok': True, 'skipped': '同じシリーズ名です'}

    # 置き換えるのはファイル名の中だけ（ディレクトリ＝アルバム名は触らない）
    d, base = os.path.dirname(old_path), os.path.basename(old_path)
    old_seg, new_seg = sanitize_path_component(old_title), sanitize_path_component(new_title)
    new_path = old_path
    if old_seg and old_seg in base:
        new_path = os.path.join(d, base.replace(old_seg, new_seg, 1))

    moved = []
    if new_path != old_path:
        if os.path.exists(new_path):
            return {'id': video_id, 'ok': False, 'error': f'同じ名前のファイルが既にあります: {new_path}'}
        dup = db.find_video_id_by_path(new_path)
        if dup is not None and dup != video_id:
            return {'id': video_id, 'ok': False,
                    'error': f'その名前は別の動画(id={dup})が使用しています'}
        if not os.path.exists(old_path):
            return {'id': video_id, 'ok': False, 'error': f'元ファイルがありません: {old_path}'}
        try:
            safe_makedirs(new_path)      # 祖父母が無ければ未マウントとみなす
        except Exception as e:
            return {'id': video_id, 'ok': False, 'error': f'置き場所を確かめられません: {e}'}
        old_stem, new_stem = os.path.splitext(old_path)[0], os.path.splitext(new_path)[0]
        try:
            shutil.move(old_path, new_path)
            moved.append((old_path, new_path))
            if os.path.exists(old_path + '.tag.json'):
                shutil.move(old_path + '.tag.json', new_path + '.tag.json')
                moved.append((old_path + '.tag.json', new_path + '.tag.json'))
            for sp in _side_files(old_stem):
                dp = new_stem + os.path.basename(sp)[len(os.path.basename(old_stem)):]
                shutil.move(sp, dp)
                moved.append((sp, dp))
        except Exception as e:
            for src, dst in reversed(moved):     # 失敗したら戻す
                try:
                    shutil.move(dst, src)
                except Exception:
                    pass
            return {'id': video_id, 'ok': False, 'error': f'名前を変えられませんでした: {e}'}
        tag['app_output_path'] = new_path
        for tkey in ('thumbnail_path', 'thumbnail_tile_path'):
            tp = tag.get(tkey)
            if tp and isinstance(tp, str) and tp.startswith(old_stem):
                tag[tkey] = new_stem + tp[len(old_stem):]

    tag['title'] = new_title
    _save_tag(new_path + '.tag.json', tag)

    # 登録し直し（シリーズ名が変わるので所属 series が変わる）。id が変わるので付随情報も移す
    cap_ids = [c['id'] for c in db.get_captures(video_id)]
    db.delete_video(video_id)
    new_id = db.add_videos(new_path + '.tag.json')
    db.relink_captures(cap_ids, new_id)
    _remap_watch_history_video(video_id, new_id)
    return {'id': video_id, 'ok': True, 'new_id': new_id, 'new_path': new_path,
            'renamed_file': new_path != old_path}


@bp.post('/videos/series/<int:series_id>/name')
async def rename_series(series_id):
    """シリーズ配下の動画のシリーズ名をまとめて変える。body: {name: 新しい名前}

    tag.json の title と、シリーズ名が入っているファイル名を書き換えて登録し直す。
    1本ずつ独立に処理し、失敗した分だけ報告する（アルバムのフォルダ名変更と同じ）。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    series = db.get_series_row(series_id)
    if not series:
        abort(404, description='シリーズが見つかりません')
    body = await _json()
    new_name = (body.get('name') or '').strip()
    if not new_name:
        abort(400, description='name が必要です')
    if any(ch in new_name for ch in ('/', os.sep, '\\')):
        abort(400, description='シリーズ名に区切り文字は使えません')
    detail = db.get_series_videos(series_id) or {}
    ids = [v['id'] for v in (detail.get('videos') or [])]
    if not ids:
        abort(404, description='このシリーズに動画がありません')

    album_id = series.get('album_id')
    # 登録し直しで series の id が変わる。id に紐づく手動設定(サムネ・並び順)は
    # 名前をキーに控えて、変更後の新しいシリーズへ戻す
    snap = db.snapshot_album_manual(album_id)
    if new_name != series.get('name') and series.get('name') in (snap.get('series') or {}):
        snap['series'][new_name] = snap['series'].pop(series['name'])
    results = [_rename_video_series(db, vid, new_name) for vid in ids]
    done = [r for r in results if r.get('ok') and r.get('new_id')]
    failed = [r for r in results if not r.get('ok')]
    new_series_id = None
    restored = 0
    if done:
        row = db.get_video_row(done[0]['new_id']) or {}
        new_series_id = row.get('series_id')
        restored = db.restore_album_manual(album_id, snap)
    import logging as _lg
    _lg.getLogger(__name__).info(
        'rename_series: series=%s %r → %r 対象%d件 変更%d件 失敗%d件 手動設定復元%d件',
        series_id, series.get('name'), new_name, len(ids), len(done), len(failed), restored)
    return jsonify({'renamed': len(done), 'total': len(ids),
                    'renamed_files': sum(1 for r in done if r.get('renamed_file')),
                    'new_series_id': new_series_id,
                    'failed': [{'id': f['id'], 'error': f.get('error')} for f in failed]})
