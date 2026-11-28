"""動画の移動の手順（事前の確かめ・置く（同じディスクならリンク）・登録の入れ替え・古いファイルの片付け・マスターへ送る）"""

import os
import data_paths
from quart import jsonify, current_app
from api.routes.tag_io import _remap_watch_history_video, _save_tag
from ..library.deletion import _side_files
from .folder_move import _album_id_of_video, _carry_album_manual


def _push_to_master_now(db, video_id):
    """encode_dir='master' の動画をライブラリサーバーへ送る。

    master への転送は logic.federation.video_push に共通化（VideoPushWorker が自動転送するため、
    ここでの即時実行が失敗/中断してもマークが残る限りワーカーが後で拾う）
    """
    from logic.federation import video_push as vp
    cap_dir = os.path.join(data_paths.DATA_DIR, 'captures')
    if not vp.try_begin(video_id):
        return jsonify({'relocated': False, 'error': '転送処理が既に実行中です'}), 409
    try:
        res = vp.push_video_to_master(
            db, current_app.config['ENCODE_AUTO'], video_id, cap_dir)
    finally:
        vp.end(video_id)
    if not res.get('relocated'):
        return jsonify({'relocated': False, 'error': res.get('error')}), res.get('status', 502)
    return jsonify({'relocated': True, 'pushed': True,
                    'old_video_id': video_id, 'remote_video_id': res.get('remote_video_id')})


def _save_resolved_tag(tag, tag_path, new_aop, old_stem, new_stem):
    """tag.json の app_output_path とサムネ最終パスを解決後パスへ更新して保存する。"""
    from logic.storage.mount_point import get_mount_point
    tag['app_output_path'] = new_aop
    for tkey in ('thumbnail_path', 'thumbnail_tile_path'):
        tp = tag.get(tkey)
        if tp and old_stem and isinstance(tp, str) and tp.startswith(old_stem):
            tag[tkey] = new_stem + tp[len(old_stem):]
    # 移動先ディスクのマウントポイントを recording_device に反映（DB と整合させる）
    try:
        tag['recording_device'] = get_mount_point(os.path.dirname(new_aop))
    except Exception:
        pass
    _save_tag(tag_path, tag)


def _refile_in_place(db, video_id, tag, tag_path):
    """ファイル移動なし。folder/title/episode_number/episode_name が変わっていれば
    DB に反映する（delete→add_videos で再ファイル）。id が変わるためクライアントが
    キャッシュを移行する。変更なしなら no-op。"""
    filing = db.get_video_filing(video_id) or {}

    def _n(x):
        return '' if x is None else str(x)
    changed = any(_n(tag.get(k)) != _n(filing.get(k))
                  for k in ('folder', 'title', 'episode_number', 'episode_name'))
    if not changed:
        return jsonify({'relocated': False, 'reason': 'unchanged'})
    # 旧行＋空 album/series 掃除（file_path を空ける）→ 新確定値で再ファイル登録（同一 file_path・新 id）
    new_id = _swap_registration(db, video_id, tag_path, delete_first=True)
    return jsonify({'relocated': False, 'updated': True,
                    'old_video_id': video_id, 'new_video_id': new_id})


def _swap_registration(db, video_id, tag_path, delete_first):
    """video.db の行を新しく登録し直し、キャプチャ・視聴履歴・シリーズの手動設定を新 id へ引き継ぐ。

    delete_first: 同じ file_path で登録し直す時は、先に消して file_path を空ける。
    """
    # delete_video で captures.video_id が NULL 化される(FK ON DELETE SET NULL)ため、
    # 消す前に控えて新 id へ付け替える(キャプチャの「▶ここから」が切れないように)
    cap_ids = [c['id'] for c in db.get_captures(video_id)]
    # フォルダが変わると series/album が作り直しになるので、シリーズのサムネ等を控える
    old_album_id = _album_id_of_video(db, video_id)
    snap = db.snapshot_album_manual(old_album_id) if old_album_id else None
    if delete_first:
        db.delete_video(video_id)
        new_id = db.add_videos(tag_path)
    else:
        new_id = db.add_videos(tag_path)
        db.delete_video(video_id)
    db.relink_captures(cap_ids, new_id)           # キャプチャを新 video へ付け替える
    _remap_watch_history_video(video_id, new_id)  # 視聴履歴リンクを old→new へ張り替え
    _carry_album_manual(db, old_album_id, snap, new_id)  # シリーズのサムネ等を引き継ぐ
    return new_id


def _relocate_preflight(db, video_id, v, new_aop, encode_dir, old_path):
    """移動してよいかを確かめる。だめなら返す応答（中止）。よければ None。"""
    import shutil
    from logic.storage.mount_point import safe_makedirs
    # 移動先に既存ファイルがある場合は中止(静かな上書きで別動画を破壊しないため。
    # 複数話まとめ録画のepisode_idx不整合で全話が同一パスへ解決した事故の再発防止)
    if os.path.exists(new_aop):
        return jsonify({'relocated': False,
                        'error': f'移動先に既存ファイルがあります(上書き防止のため中止): {new_aop}'}), 409
    # 移動先パスを既に別の video が使っている場合も中止する。
    # 実ファイルが消えていても DB 行だけ残っているとこのケースになり、そのまま進めると
    # add_videos が「同じ file_path の既存行」を見つけて新規登録せずその id を返すため、
    # 中身は移動してきた動画・DB の確定値は別動画のもの、という不整合な行が出来てしまう
    # （同じ番組のカードが二つ残る原因）。
    dup_id = db.find_video_id_by_path(new_aop)
    if dup_id is not None and dup_id != video_id:
        return jsonify({'relocated': False,
                        'error': f'移動先のパスは既に別の動画(id={dup_id})が使用しています(中止): {new_aop}'}), 409
    try:
        # 祖父母が無ければ未マウントとみなし ValueError。ただし音楽は
        # <encode_dir>/<アーティスト>/<アルバム>/ と一度に2階層増えることがあるので、
        # encode_dir の実在をもって未マウント検知とする
        base = encode_dir if (v.get('media_kind') == 'audio' and encode_dir) else None
        safe_makedirs(new_aop, base=base)
    except Exception as e:
        return jsonify({'relocated': False, 'error': f'コピー先が未マウント/作成不可: {e}'}), 409
    if not (old_path and os.path.exists(old_path)):
        return jsonify({'relocated': False, 'error': '元ファイルが存在しません'}), 409
    src_size = os.path.getsize(old_path)
    # 同じディスクの中ならリンクで置くので、空きは要らない
    free = float('inf') if _same_disk(old_path, os.path.dirname(new_aop)) else shutil.disk_usage(os.path.dirname(new_aop)).free
    if free < src_size * 1.1:  # 10% の余裕
        return jsonify({'relocated': False, 'error': f'空き容量不足（必要 {src_size} / 空き {free}）'}), 507
    return None


def _same_disk(path, dest_dir):
    """path と dest_dir が同じファイルシステムにあるか（調べられなければ False）"""
    try:
        return os.stat(path).st_dev == os.stat(dest_dir).st_dev
    except OSError:
        return False


def _place(src, dst):
    """src を dst にも置く。同じディスクならリンクで一瞬に（中身は写さない）、できなければコピー。

    元はこの後 _remove_old_files で消すので、リンクでも結果は「移動」と同じ。数 GB を丸ごと
    写していた頃は 20 秒ほどかかり、画面が待ちきれずに失敗と出ていた。
    途中で止まっても元のファイルはそのまま残る（コピーの時と同じ）。
    """
    import shutil
    if _same_disk(src, os.path.dirname(dst)):
        try:
            os.link(src, dst)
            return
        except OSError:
            pass                     # リンクできないファイルシステム・権限なら写す
    shutil.copy2(src, dst)


def _copy_video_files(old_path, new_aop, tag_path, old_stem, new_stem, src_size):
    """mp4・tag.json・サムネ等を移動先へ置く（同じディスクならリンク、別ならコピー）。
    失敗したら置いた分を消して、中止の応答を返す。"""
    copied = []
    try:
        _place(old_path, new_aop); copied.append(new_aop)
        if os.path.getsize(new_aop) != src_size:
            raise IOError('コピー後サイズ不一致')
        _place(tag_path, new_aop + '.tag.json'); copied.append(new_aop + '.tag.json')
        for sp in (_side_files(old_stem) if old_stem else []):
            d = new_stem + os.path.basename(sp)[len(os.path.basename(old_stem)):]
            _place(sp, d); copied.append(d)
    except Exception as e:
        for f in copied:
            try: os.remove(f)
            except Exception: pass
        return jsonify({'relocated': False, 'error': f'コピー失敗（中止）: {e}'}), 500
    return None


def _remove_old_files(old_path, old_stem):
    """移動元の mp4・tag.json・サムネを消す。移動元フォルダが空になったら消す（1階層のみ）。"""
    for f in (old_path, (old_path + '.tag.json') if old_path else None,
              (old_stem + '.thumbnail.webp') if old_stem else None,
              (old_stem + '.thumbnail_tile.webp') if old_stem else None):
        if f and os.path.exists(f):
            try: os.remove(f)
            except Exception: pass
    # 移動元ディレクトリが空になったら削除する（push_video_to_master と同じ扱い）
    old_dir = os.path.dirname(old_path) if old_path else ''
    try:
        if old_dir and not os.listdir(old_dir):
            os.rmdir(old_dir)
    except OSError:
        pass
