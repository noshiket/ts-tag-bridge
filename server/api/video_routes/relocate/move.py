"""アルバムのフォルダ名・動画の移動・実況の強制表示"""

import os
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag
from ..confirmed.tag import _video_tag_path  # noqa: F401
from .folder_move import _carry_album_manual, _move_video_folder
from .steps import _push_to_master_now, _save_resolved_tag, _refile_in_place, _swap_registration, _relocate_preflight, _copy_video_files, _remove_old_files  # noqa: F401


@bp.post('/videos/albums/<int:album_id>/folder')
async def rename_album_folder(album_id):
    """アルバム(=フォルダ)配下の動画をまとめて別フォルダへ移す。body: {folder: 新しい名前}

    実ファイル(mp4/tag.json/サムネ)を移動し、tag.json の folder と、folder と同名の
    category も書き換えて登録し直す。1本ずつ独立に処理し、失敗した分だけ報告する。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    new_folder = (body.get('folder') or '').strip()
    if not new_folder:
        abort(400, description='folder が必要です')
    if any(ch in new_folder for ch in ('/', os.sep, '\\')):
        abort(400, description='フォルダ名に区切り文字は使えません')
    ids = db.get_album_video_ids(album_id)
    if not ids:
        abort(404, description='このアルバムに動画がありません')

    # series/album は登録し直しで id が変わる。id に紐づく手動設定(シリーズのサムネ・
    # 並び順、アルバムの説明)は名前をキーに控えておき、移動後に新しい方へ戻す
    snap = db.snapshot_album_manual(album_id)
    results = [_move_video_folder(db, vid, new_folder) for vid in ids]
    moved = [r for r in results if r.get('ok') and r.get('new_id')]
    failed = [r for r in results if not r.get('ok')]
    new_album_id = None
    restored = 0
    if moved:
        # videos は series 経由でしか album を持たないので series から辿る
        row = db.get_video_row(moved[0]['new_id']) or {}
        sr = db.get_series_row(row.get('series_id')) if row.get('series_id') else None
        new_album_id = (sr or {}).get('album_id')
        restored = _carry_album_manual(db, album_id, snap, moved[0]['new_id'])
    import logging as _lg
    _lg.getLogger(__name__).info(
        'rename_album_folder: album=%s → %r 対象%d件 移動%d件 失敗%d件 手動設定復元%d件',
        album_id, new_folder, len(ids), len(moved), len(failed), restored)
    return jsonify({'moved': len(moved), 'total': len(ids), 'new_album_id': new_album_id,
                    'failed': [{'id': f['id'], 'error': f.get('error')} for f in failed]})


@bp.post('/videos/<int:video_id>/relocate')
def relocate_video(video_id):
    """確定値編集後の再配置。tag.json の app_output_path に {$encode_dir} 等の未解決
    プレースホルダがあれば encode_dir で解決し、現パスと異なればファイルをコピーして
    add_videos で新規登録、旧 video.db 行と旧ファイルを削除する。
    マウント/容量/コピー検証を行い、いずれか失敗で中止（旧データ無傷）。"""
    from logic.encode_pipeline.common import _apply_encode_dir, FED_MASTER

    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    tag = _load_tag(tag_path) if tag_path else None
    if tag is None:
        abort(404, description='tag.json を読めません（無いか壊れています。サーバーログに理由が出ます）')

    aop = tag.get('app_output_path') or ''
    encode_dir = tag.get('encode_dir')

    # federation: encode_dir='master' はディレクトリ名ではなくライブラリサーバーへの
    # 送信指定。リテラル置換すると 'master/...' という実在しないパスになるため、
    # プレースホルダ有無より先に判定する（過去の誤置換でプレースホルダを失った tag も救済）。
    if encode_dir == FED_MASTER:
        return _push_to_master_now(db, video_id)

    if '{$' not in aop:
        # 置き場所は解決済み（解析に出力パスが無く、確定値の解決済みパスがそのまま来た時など）。
        # 今のファイルと同じ場所なら、話数名などの変更だけを DB へ反映する。
        # 以前はここで何もせず返していて、「解析値を確定値に反映」しても DB が変わらなかった
        if not aop or aop == v.get('file_path'):
            return _refile_in_place(db, video_id, tag, tag_path)
        return jsonify({'relocated': False, 'reason': 'no_placeholder'})

    if not encode_dir:
        return jsonify({'relocated': False, 'error': 'tag.json に encode_dir がありません'}), 400
    new_aop = _apply_encode_dir(aop, encode_dir)
    if '{$' in (new_aop or ''):
        return jsonify({'relocated': False, 'error': f'未解決のプレースホルダが残っています: {new_aop}'}), 400

    old_path = v.get('file_path')
    old_stem = os.path.splitext(old_path)[0] if old_path else None
    new_stem = os.path.splitext(new_aop)[0]
    _save_resolved_tag(tag, tag_path, new_aop, old_stem, new_stem)

    if new_aop == old_path:
        return _refile_in_place(db, video_id, tag, tag_path)

    # --- 安全チェック ---
    err = _relocate_preflight(db, video_id, v, new_aop, encode_dir, old_path)
    if err:
        return err
    src_size = os.path.getsize(old_path)

    # --- コピー（mp4 + tag.json + サムネ）。検証失敗で全削除して中止 ---
    err = _copy_video_files(old_path, new_aop, tag_path, old_stem, new_stem, src_size)
    if err:
        return err

    # --- 新規登録 → 旧削除 ---
    new_id = _swap_registration(db, video_id, new_aop + '.tag.json', delete_first=False)
    _remove_old_files(old_path, old_stem)
    return jsonify({'relocated': True, 'old_video_id': video_id, 'new_video_id': new_id, 'new_path': new_aop})




