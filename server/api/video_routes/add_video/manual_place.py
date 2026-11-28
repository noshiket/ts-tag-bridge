"""手で足す動画の局の識別と置き場所"""

import os
import shutil
from quart import current_app
from ..library.manual_defaults import _upload_roots
from ..confirmed.tag_paths import _manual_dest_path


# EDCB のサービス一覧に無い局(配信・外部ソース等)へ割り当てる合成 SID の開始値。
# 実放送の SID は 16bit だが実データは3万未満なので、衝突しない上位を使う
_SYNTHETIC_SID_BASE = 60000


def _station_ids_for(db, station_name: str) -> dict:
    """局名から onid/tsid/sid を決める。

    同じ局名の既存 video があればその識別子を引き継ぐ（局名と SID はセットで扱う値なので、
    同じ局に別の SID を振らない）。無ければ実放送と衝突しない範囲から新しく採る。
    """
    conn = db._get_conn()
    row = conn.execute(
        'SELECT onid, tsid, sid FROM videos WHERE eit_station_name = ? AND sid IS NOT NULL '
        'ORDER BY id DESC LIMIT 1', (station_name,)).fetchone()
    if row is not None:
        return {'onid': row['onid'], 'tsid': row['tsid'], 'sid': row['sid']}
    row = conn.execute('SELECT MAX(sid) AS m FROM videos WHERE sid >= ?',
                       (_SYNTHETIC_SID_BASE,)).fetchone()
    return {'onid': 0, 'tsid': 0, 'sid': int((row['m'] or _SYNTHETIC_SID_BASE - 1) + 1)}


def _place_manual_video(tag: dict, file_path: str, encode_dir: str, copy: bool) -> dict:
    """手入力で追加する動画を app_output_path_format の位置へ移動/コピーする。"""
    from logic.storage.mount_point import safe_makedirs

    config = current_app.config['ENCODE_AUTO']
    roots = _upload_roots(config)
    real_root = os.path.realpath(encode_dir)
    if not roots or not any(real_root == r or real_root.startswith(r + os.sep) for r in roots):
        return {'error': '保存先は encode_dir_list 配下のディレクトリを指定してください'}
    dest, template = _manual_dest_path(config, tag, file_path, encode_dir)
    if not dest or '{$' in dest:
        return {'error': f'置き場所を決められません（未解決の項目があります）: {dest}'}
    tag['app_output_path_format'] = template
    if os.path.realpath(dest) == os.path.realpath(file_path):
        tag['encode_dir'] = encode_dir
        return {'path': file_path}
    if os.path.exists(dest):
        return {'error': f'移動先に既にファイルがあります: {dest}'}
    try:
        safe_makedirs(dest)
    except Exception as e:
        return {'error': f'移動先を作れません: {e}'}
    try:
        if copy:
            shutil.copy2(file_path, dest)
        else:
            shutil.move(file_path, dest)
    except Exception as e:
        return {'error': f'{"コピー" if copy else "移動"}に失敗しました: {e}'}
    tag['app_output_path'] = dest
    tag['encode_dir'] = encode_dir
    return {'path': dest}
