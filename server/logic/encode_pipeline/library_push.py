"""エンコードした動画をライブラリへ（マスターへ送る・この場で登録する・送った後の片付け）"""

import json
import os
from datetime import datetime
from .common import logger
from .base.context import _get_video_db
from .push_captures import _captures_dir, _cleanup_pushed_captures, _collect_push_captures
from .file_transfer import _try_push_master_direct
import data_paths



_users_db = None


def _get_users_db():
    """users.db への接続（UsersDB）をモジュール内で再利用する（worker スレッド用に直開き）。
    再エンコードでの video 差し替え時に視聴履歴リンクを張り替えるために使う。"""
    global _users_db
    if _users_db is None:
        from db.user_db.core import UsersDB
        _users_db = UsersDB(os.path.join(data_paths.DATA_DIR, 'users.db'))
    return _users_db


def _push_master_direct(db, enc, amz_vols, client, config) -> bool:
    """encode_dir==FED_MASTER の時、一次ファイルから直接ライブラリサーバーへ push を試す。できたら True。

    encode_dir_list(外付けHDD等)への一次コピーを経由せず一次ファイル(tmp_dir、Amatsukaze出力そのもの)
    から直接pushを試みる。書き込みの遅いディスクへ一旦コピー→push→削除、という無駄な往復を避けるため。
    失敗時のみ、従来通りencode_dir_listへコピーしてからpushするフォールバック経路へ進む。
    """
    enc_id = enc['id']
    fed_direct = (config or {}).get('federation') or {}
    encode_info_direct = json.loads(enc.get('encode_info') or '{}')
    try:
        video_id = _try_push_master_direct(enc, encode_info_direct, amz_vols, client, fed_direct)
    except Exception as e:
        logger.warning('run_file_copy: enc_id=%d direct push failed: %s (encode_dir_list経由にフォールバック)',
                        enc_id, e)
        video_id = None
    if video_id is not None:
        encode_info_direct['fed_push'] = {
            'peer': fed_direct['library_peer'].get('name'),
            'video_id': video_id,
            'at': datetime.now().isoformat(),
        }
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info_direct, ensure_ascii=False))
        logger.info('run_file_copy: enc_id=%d → federation direct push video_id=%s (一次コピーをスキップ)',
                    enc_id, video_id)
        return True
    logger.info('run_file_copy: enc_id=%d direct push未成立、encode_dir_list経由にフォールバック', enc_id)
    return False


def _push_to_library(db, enc, encode_info, fed, tag_dst) -> bool:
    """コピーした動画をライブラリサーバーへ push する。できたら True（失敗はローカル登録へ回す）。"""
    enc_id = enc['id']
    try:
        from clients.fed_client import FedClient
        caps = _collect_push_captures(enc['recording_id'])
        fed_video_id = FedClient(fed).push_video(tag_dst, captures=caps,
                                                 capture_dir=_captures_dir())
        _cleanup_pushed_captures(caps)
        encode_info['fed_push'] = {
            'peer': fed['library_peer'].get('name'),
            'video_id': fed_video_id,
            'at': datetime.now().isoformat(),
        }
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info, ensure_ascii=False))
        logger.info('run_file_copy: enc_id=%d → federation push video_id=%s', enc_id, fed_video_id)
        return True
    except Exception as e:
        logger.warning('run_file_copy: enc_id=%d federation push failed: %s (ローカル登録にフォールバック)',
                       enc_id, e)
        return False


def _remove_pushed_files(enc_id, tag_dst, app_output_path):
    """push したので、このノード側のファイルを消す（「移動」。ライブラリサーバー側で mp4 サイズ検証済み）。
    消し損ねても video.db には登録済みなので警告ログのみで続行する。"""
    with open(tag_dst, encoding='utf-8') as f:
        pushed_tag = json.load(f)
    for p in (pushed_tag.get('app_output_path'), tag_dst,
              pushed_tag.get('thumbnail_path'), pushed_tag.get('thumbnail_tile_path')):
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except OSError as e:
                logger.warning('run_file_copy: enc_id=%d push後のファイル削除失敗 %s: %s', enc_id, p, e)
    try:
        folder_dir = os.path.dirname(app_output_path)
        if not os.listdir(folder_dir):
            os.rmdir(folder_dir)
    except OSError:
        pass


def _register_local_video(enc, tag_dst):
    """コピー済み tag.json を video.db に登録（best-effort。失敗してもエンコードは止めない）。

    replace=True: file_path(app_output_path) が既存なら旧行を削除してから登録し直す
    （再エンコード/再コピーで最新の tag.json 内容を反映。重複行も作らない）。
    """
    enc_id = enc['id']
    try:
        video_db = _get_video_db()
        # 再エンコードで既存動画を差し替えて id が変わった場合、視聴履歴リンクを old→new へ張り替える
        video_id = video_db.add_videos(
            tag_dst, replace=True,
            on_replace=lambda old, new: _get_users_db().remap_video_watch_history(old, new))
        logger.info('run_file_copy: enc_id=%d → video.db video_id=%s', enc_id, video_id)
        # エンコード前の録画再生中に撮って recording_id だけで登録されていたキャプチャを
        # この動画の video_id へ張り替える（本エンコードのdstに限らず同一recording由来の
        # 未リンクキャプチャを一括対象にする＝複数話エンコードでも取りこぼさない）。
        try:
            linked = video_db.link_captures_by_recording(enc['recording_id'], video_id)
            if linked:
                logger.info('run_file_copy: enc_id=%d recording_id=%d のキャプチャ%d件をvideo_id=%sへ張り替え',
                           enc_id, enc['recording_id'], linked, video_id)
        except Exception as e:
            logger.warning('run_file_copy: capture link failed enc_id=%d: %s', enc_id, e)
    except Exception as e:
        logger.warning('run_file_copy: video.db registration failed enc_id=%d: %s', enc_id, e)
