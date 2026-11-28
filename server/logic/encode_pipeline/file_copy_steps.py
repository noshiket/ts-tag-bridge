"""エンコード後の写しの手順（置き場所を決める・録画の機器・元の tag.json・写す/写せない理由）"""

import json
import os
from typing import Optional
from logic.storage.mount_point import get_mount_point
from .common import FED_MASTER, _apply_encode_dir, logger
from .placeholders import _get_ei_tag_path
from .file_transfer import _copy_encoded_files



def _pick_available_encode_dir(db, config) -> Optional[str]:
    """encode_dir_list を優先順に走査し、最初に利用可能な（取り外されていない）encode_dir を返す。"""
    from logic.storage.disk_guard import register_path_disk
    for c in (config or {}).get('encode_dir_list') or []:
        try:
            register_path_disk(db, c)   # 現在のマウント状態を反映（オンラインならマーカー確認/生成）
        except Exception as e:
            logger.warning('encode_dir %s のディスク登録に失敗: %s', c, e)
        if not db.disk_offline(c):
            return c
    return None


def _resolve_encode_dir(db, enc, config) -> bool:
    """割当先ディスクが取り外し中（または master）なら、使える出力先へ enc['encode_dir'] を切り替える。
    使える先が無ければ error_message を書いて False。

    encode_dir==FED_MASTER（実ディレクトリではない予約値）の場合は disk_offline() に渡さず
    （非パス値は os.path.realpath がcwd相対解決してしまい常にオンライン扱いになるため）、
    必ず _pick_available_encode_dir で実ディレクトリへ解決する。
    """
    enc_id = enc['id']
    encode_dir = enc.get('encode_dir')
    is_master = (encode_dir == FED_MASTER)
    if not (encode_dir and (is_master or db.disk_offline(encode_dir))):
        return True
    alt = _pick_available_encode_dir(db, config)
    if not alt:
        err = (f'encode_dir={encode_dir} の実体ディレクトリが見つかりません（encode_dir_listが空か全滅）'
               if is_master else
               f'encode_dir={encode_dir} のディスクが取り外し中で、利用可能な代替の出力先がありません')
        db.update_encoding(enc_id, error_message=err)
        logger.warning('run_file_copy: enc_id=%d %s', enc_id, err)
        return False
    if alt != encode_dir:
        if not is_master:
            logger.warning('run_file_copy: enc_id=%d encode_dir=%s 取り外し中 → %s へフォールバック',
                           enc_id, encode_dir, alt)
            db.update_encoding(enc_id, encode_dir=alt)
        # is_master の場合はここではDBへ永続化しない。コピー/push成功前にencode_dir='master'を
        # 実パスへ書き換えてしまうと、その後コピー自体が失敗(ディスク未作成等)しても
        # 'master'指定が失われ、次回リトライで_try_push_master_direct/pushが二度と
        # 試みられなくなる不具合があった(実際に発生: 出力先ディレクトリ未作成で失敗した
        # 直後にもencode_dirだけが実パスへ変わってしまっていた)。is_masterの場合は
        # push最終確定(このコピー先へのローカル登録が確定した時点、後述)まで
        # DB上はmasterのまま維持し、enc['encode_dir']のみローカルで実パスへ差し替える。
        enc['encode_dir'] = alt
    return True


def _record_recording_device(db, enc, app_output_path):
    """出力先のマウント点を recording_device に記録し、app_output_path_format の中の
    マウント点を {$recording_device} に置き換える。(マウント点, 置き換え後の書式) を返す。"""
    enc_id = enc['id']
    mount_dir = get_mount_point(os.path.dirname(os.path.realpath(app_output_path)))

    db.update_encoding(enc_id, recording_device=mount_dir)
    logger.debug('run_file_copy: enc_id=%d recording_device=%s', enc_id, mount_dir)

    # app_output_path_format 内の recording_device 部分を {$recording_device} に置換
    fmt = enc.get('app_output_path_format') or ''
    if fmt and mount_dir != '/' and '{$recording_device}' not in fmt:
        updated_fmt = fmt.replace(mount_dir, '{$recording_device}')
        if updated_fmt != fmt:
            db.update_encoding(enc_id, app_output_path_format=updated_fmt)
            logger.info('run_file_copy: enc_id=%d app_output_path_format updated: %s', enc_id, updated_fmt)
            fmt = updated_fmt
    return mount_dir, fmt


def _update_source_tag(enc, encode_info, amz_vols, app_output_path, mount_dir, fmt, new_thumb, new_tile):
    """コピー元の tag.json に recording_device / app_output_path_format と、実際の出力先を書く。"""
    src_tag = _get_ei_tag_path(encode_info, amz_vols)
    if not (src_tag and os.path.exists(src_tag)):
        return
    try:
        with open(src_tag, encoding='utf-8') as f:
            tag = json.load(f)
        new_tag = {}
        for k, v in tag.items():
            if k == 'recording_start_time':
                new_tag['recording_device'] = mount_dir
                if fmt:
                    new_tag['app_output_path_format'] = fmt
            # app_output_path はリテラル {$encode_dir} を実パスへ解決し、
            # encode_dir は実際に使った（フォールバック反映済みの）値へ更新する。
            # video_db は tag.json の app_output_path を実ファイルパスとして使うため必須。
            if k == 'app_output_path':
                v = app_output_path
            elif k == 'encode_dir':
                v = enc.get('encode_dir')
            # フォールバックで encode_dir が変わった場合はサムネ最終パスも差し替え
            elif k == 'thumbnail_path' and new_thumb:
                v = new_thumb
            elif k == 'thumbnail_tile_path' and new_tile:
                v = new_tile
            new_tag[k] = v
        if 'recording_device' not in new_tag:
            new_tag['recording_device'] = mount_dir
            if fmt:
                new_tag['app_output_path_format'] = fmt
        with open(src_tag, 'w', encoding='utf-8') as f:
            json.dump(new_tag, f, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        logger.warning('run_file_copy: source tag update failed enc_id=%d: %s', enc['id'], e)


def _copy_or_reason(enc, encode_info, amz_vols, client) -> Optional[str]:
    """エンコード済みファイルをコピーする。失敗したら理由を返す（成功なら None）。"""
    enc_id = enc['id']
    copy_err: Optional[str] = None
    try:
        copied = _copy_encoded_files(enc, encode_info, amz_vols, client)
        if not copied:
            # 原因を区別する: 出力先未設定(確定値のapp_output_path欠落)とコピー元不在は別問題
            if not _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir')):
                copy_err = ('出力先(app_output_path)が未設定です。確定値を設定してから '
                            'make_DBリトライで行を作り直してください')
            else:
                copy_err = 'コピー元ファイルが見つかりません'
            logger.warning('run_file_copy: copy failed enc_id=%d: %s', enc_id, copy_err)
    except Exception as e:
        copy_err = str(e)
        logger.warning('run_file_copy: copy failed enc_id=%d: %s', enc_id, e)
    return copy_err
