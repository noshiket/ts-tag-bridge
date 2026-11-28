"""動画のフォルダ（アルバム）を変えて移す（設定順を引き継ぐ）"""

import os
import shutil
from quart import current_app
from api.routes.tag_io import _load_tag, _remap_watch_history_video, _save_tag
from ..library.deletion import _side_files


def _album_id_of_video(db, video_id: int):
    """video が属する album id（series 経由）。無ければ None。"""
    row = db.get_video_row(video_id) or {}
    sid = row.get('series_id')
    if not sid:
        return None
    return (db.get_series_row(sid) or {}).get('album_id')


def _carry_album_manual(db, old_album_id, snap, new_video_id) -> int:
    """フォルダが変わって album/series が作り直しになった時、手動設定を新しい方へ引き継ぐ。

    対象はシリーズのサムネ・並び順とアルバムの説明。id 紐づけなので、そのままだと
    「移動したらシリーズのサムネが外れる」ことになる。
    マイリスト(users.db)はアルバムidで持っているが、こちらは元のアルバムが無くなった
    時だけ張り替える(1本だけ移した場合、元アルバムに残っている人のマイリストは動かさない)。
    """
    if not old_album_id or not snap or not new_video_id:
        return 0
    new_album_id = _album_id_of_video(db, new_video_id)
    if not new_album_id or new_album_id == old_album_id:
        return 0
    n = db.restore_album_manual(new_album_id, snap)
    if db.get_album_row(old_album_id) is None:      # 元アルバムが消えた＝丸ごと移動した
        users_db = current_app.config.get('USERS_DB')
        if users_db is not None:
            try:
                users_db.remap_mylist_album(old_album_id, new_album_id)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning('マイリストの張り替えに失敗: %s', e)
    return n


def _move_video_folder(db, video_id: int, new_folder: str) -> dict:
    """1本の動画を別フォルダへ移す（mp4/tag.json/サムネをまとめて mv する）。

    移動先は「今のパス」と「今の folder」から推定する: パス中の
    サニタイズ済みフォルダ名（'!'→'！' 等。text_parser.sanitize_path_component と同じ規則）を
    新しい名前へ置き換える。tag.json の folder と、folder と同名の category も書き換える。
    id は変わる（フォルダ＝アルバムなので登録し直しになる）。
    """
    from logic.storage.mount_point import safe_makedirs
    from text_parser.paths import sanitize_path_component

    v = db.get_video_row(video_id)
    if v is None:
        return {'id': video_id, 'ok': False, 'error': '動画が見つかりません'}
    old_path = v.get('file_path') or ''
    tag_path = old_path + '.tag.json' if old_path else ''
    tag = _load_tag(tag_path) if tag_path else None
    if not old_path or tag is None:
        return {'id': video_id, 'ok': False, 'error': 'tag.json が見つかりません'}

    old_folder = tag.get('folder') or ''
    if not old_folder:
        return {'id': video_id, 'ok': False, 'error': 'フォルダが設定されていません'}
    if old_folder == new_folder:
        return {'id': video_id, 'ok': True, 'skipped': '同じフォルダ名です'}

    old_seg = sanitize_path_component(old_folder)
    new_seg = sanitize_path_component(new_folder)
    parts = old_path.split(os.sep)
    # 同名のディレクトリが複数あり得るので、ファイルに近い方（最後）を置き換える
    try:
        idx = len(parts) - 1 - parts[::-1].index(old_seg)
    except ValueError:
        return {'id': video_id, 'ok': False,
                'error': f'パスの中にフォルダ名 {old_seg!r} が見つかりません: {old_path}'}
    parts[idx] = new_seg
    new_path = os.sep.join(parts)
    # パスに使える形に直すと同じになる名前（'！' と '!' 等）への変更では、パスは変わらない。
    # それでもアルバムは tag.json の folder で分かれるので、ファイルは動かさずに folder だけ
    # 書き換えて登録し直す（以前はここで打ち切り、folder が変わらず統合されなかった）
    same_path = new_path == old_path
    old_stem, new_stem = os.path.splitext(old_path)[0], os.path.splitext(new_path)[0]
    if not same_path:
        if os.path.exists(new_path):
            return {'id': video_id, 'ok': False, 'error': f'移動先に既にファイルがあります: {new_path}'}
        dup = db.find_video_id_by_path(new_path)
        if dup is not None and dup != video_id:
            return {'id': video_id, 'ok': False,
                    'error': f'移動先のパスは別の動画(id={dup})が使用しています'}
        if not os.path.exists(old_path):
            return {'id': video_id, 'ok': False, 'error': f'元ファイルがありません: {old_path}'}
        try:
            safe_makedirs(new_path)      # 祖父母が無ければ未マウントとみなす
        except Exception as e:
            return {'id': video_id, 'ok': False, 'error': f'移動先を作れません: {e}'}

        # 本体 → 付随ファイルの順。本体さえ動けば tag は下で書き直すので取りこぼしても直せる
        moved = []
        try:
            shutil.move(old_path, new_path)
            moved.append((old_path, new_path))
            for suf in ('.tag.json', ):
                if os.path.exists(old_path + suf):
                    shutil.move(old_path + suf, new_path + suf)
                    moved.append((old_path + suf, new_path + suf))
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
            return {'id': video_id, 'ok': False, 'error': f'移動に失敗しました: {e}'}

    # tag.json を新しい場所の内容へ更新（folder / category / パス）
    tag['folder'] = new_folder
    cats = tag.get('category')
    if isinstance(cats, list):
        tag['category'] = [new_folder if c == old_folder else c for c in cats]
    elif isinstance(cats, str) and cats == old_folder:
        tag['category'] = new_folder
    tag['app_output_path'] = new_path
    for tkey in ('thumbnail_path', 'thumbnail_tile_path'):
        tp = tag.get(tkey)
        if tp and isinstance(tp, str) and tp.startswith(old_stem):
            tag[tkey] = new_stem + tp[len(old_stem):]
    _save_tag(new_path + '.tag.json', tag)

    # 登録し直し（フォルダ＝アルバムなので所属が変わる）。id が変わるので付随情報も移す
    cap_ids = [c['id'] for c in db.get_captures(video_id)]
    db.delete_video(video_id)
    new_id = db.add_videos(new_path + '.tag.json')
    db.relink_captures(cap_ids, new_id)
    _remap_watch_history_video(video_id, new_id)

    old_dir = os.path.dirname(old_path)
    try:
        if old_dir and not os.listdir(old_dir):
            os.rmdir(old_dir)
    except OSError:
        pass
    return {'id': video_id, 'ok': True, 'new_id': new_id, 'new_path': new_path}
