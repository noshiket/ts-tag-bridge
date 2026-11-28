"""エンコード済みファイルのコピーと、ライブラリサーバー(マスター)への送信・キャプチャの受け渡し"""

import json
import os
import shutil
from typing import Optional
from logic.storage.path_translator import container_to_host
from logic.storage.mount_point import safe_makedirs
from .common import (  # noqa: F401
    _apply_encode_dir,
    logger,
)
from .placeholders import _get_ei_tag_path, _get_profile_ext_from_list  # noqa: F401
from .encoded_output import _resolve_encoded_output  # noqa: F401
from .push_captures import _captures_dir, _collect_push_captures, _cleanup_pushed_captures  # noqa: F401


def _copy_encoded_files(enc: dict, encode_info: dict, amz_vols: list, client) -> bool:
    """
    エンコード済みファイルを outputs.dstPath から app_output_path へコピーする。
    .tag.json も同時にコピーする（元ファイルは残す）。
    """
    app_output_path = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir'))
    if not app_output_path:
        logger.warning('_copy_encoded_files: enc_id=%d app_output_path not set, skip', enc['id'])
        return False

    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    if not outputs:
        logger.warning('_copy_encoded_files: enc_id=%d outputs empty, skip', enc['id'])
        return False

    try:
        profiles = client.get_profiles() if client is not None else []
    except Exception as e:
        logger.warning('_copy_encoded_files: get_profiles failed: %s', e)
        profiles = []

    input_ts_amz = encode_info.get('input_ts', '')
    stem = os.path.splitext(os.path.basename(input_ts_amz))[0]
    # アドオンエンコーダーは自分が生成した出力パスを返しているので探索しない
    addon_out = encode_info.get('addon_output_path')

    copied = False
    for out in outputs:
        dst_amz = out.get('dstPath', '').rstrip('/')
        profile_name = out.get('profile', '')
        ext = _get_profile_ext_from_list(profiles, profile_name)

        dst_app = container_to_host(dst_amz, amz_vols)
        # canonical(stem+ext) が 0バイト/不在なら Amatsukaze ログの [出力ファイル] から実出力を解決
        src_app = (addon_out if addon_out and os.path.exists(addon_out)
                   else _resolve_encoded_output(dst_app, stem, amz_vols, ext))
        tag_src_app = container_to_host(dst_amz + '/' + stem + '.tag.json', amz_vols)

        if not src_app:
            logger.warning('_copy_encoded_files: src not found (0byte/不在): dst=%s stem=%s', dst_app, stem)
            continue

        safe_makedirs(app_output_path)
        shutil.copy2(src_app, app_output_path)
        logger.info('_copy_encoded_files: %s → %s', src_app, app_output_path)
        copied = True

        if os.path.exists(tag_src_app):
            shutil.copy2(tag_src_app, app_output_path + '.tag.json')
            logger.info('_copy_encoded_files: tag %s → %s', tag_src_app, app_output_path + '.tag.json')

        app_stem = os.path.splitext(app_output_path)[0]
        for attr, suffix in (('thumbnail_path', '.thumbnail.webp'), ('thumbnail_tile_path', '.thumbnail_tile.webp')):
            thumb_src = encode_info.get(attr)
            if thumb_src and os.path.exists(thumb_src):
                try:
                    thumb_dst = app_stem + suffix
                    shutil.copy2(thumb_src, thumb_dst)
                    logger.info('_copy_encoded_files: thumbnail %s → %s', thumb_src, thumb_dst)
                except Exception as e:
                    logger.warning('_copy_encoded_files: thumbnail copy failed: %s', e)

    return copied


def _try_push_master_direct(enc: dict, encode_info: dict, amz_vols: list, client,
                             fed: dict) -> Optional[int]:
    """encode_dir==FED_MASTERの場合、一次ファイル(tmp_dir、Amatsukaze出力そのもの)から
    直接ライブラリサーバーへpushする。書き込みの遅い外付けHDD等(encode_dir_list)へ一旦
    コピーしてからpushして削除する、という無駄な往復を避けるための近道。

    成功時: video_id を返す。tmp_dir の一次ファイル(mp4/tag.json/サムネ)は削除しない
    (呼び出し元run_file_copyが通常のtmp_dir掃除ロジックに任せる)。
    失敗/前提条件未達時: None を返す（呼び出し元が従来通りencode_dir_listへコピー後にpush
    するフォールバック経路へ進む）。
    """
    if not fed.get('library_peer'):
        return None
    ei_tag = _get_ei_tag_path(encode_info, amz_vols)
    if not ei_tag or not os.path.exists(ei_tag):
        return None

    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    if not outputs:
        return None

    try:
        profiles = client.get_profiles() if client is not None else []
    except Exception as e:
        logger.warning('_try_push_master_direct: get_profiles failed: %s', e)
        profiles = []

    input_ts_amz = encode_info.get('input_ts', '')
    stem = os.path.splitext(os.path.basename(input_ts_amz))[0]
    out = outputs[0]
    dst_amz = out.get('dstPath', '').rstrip('/')
    profile_name = out.get('profile', '')
    ext = _get_profile_ext_from_list(profiles, profile_name)
    dst_app = container_to_host(dst_amz, amz_vols)
    # アドオンエンコーダーは自分が生成した出力パスを返しているので探索しない
    addon_out = encode_info.get('addon_output_path')
    src_app = (addon_out if addon_out and os.path.exists(addon_out)
               else _resolve_encoded_output(dst_app, stem, amz_vols, ext))
    if not src_app:
        logger.warning('_try_push_master_direct: enc_id=%d 一次ファイルが見つかりません', enc['id'])
        return None

    # push用のtag内容だけを一次ファイル基準に補正した一時ファイルを作る(元のei_tagは
    # run_file_copy側の後続処理[フォールバック時]がそのまま参照できるよう書き換えない)。
    with open(ei_tag, encoding='utf-8') as f:
        tag = json.load(f)
    # 受信側は basename(app_output_path)/basename(thumbnail_path) で配置名を決めるため、
    # tag には「意図した話数名」を入れ、実アップロード元(tmpの cut.*)は src_files で渡す。
    # 以前は tag['app_output_path']=src_app(=cut.mp4) にしていたため、多話数録画で全話が
    # 同じ cut.mp4 に push され上書きし合っていた。
    intended = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir')) or src_app
    out_dir = os.path.dirname(src_app)
    out_name = os.path.basename(intended)
    app_stem = os.path.splitext(out_name)[0]
    tag['app_output_path'] = os.path.join(out_dir, out_name)
    src_files = {'app_output_path': src_app}
    for attr, suffix in (('thumbnail_path', '.thumbnail.webp'),
                         ('thumbnail_tile_path', '.thumbnail_tile.webp')):
        local = encode_info.get(attr)
        if local:
            tag[attr] = os.path.join(out_dir, app_stem + suffix)
            src_files[attr] = local

    push_tag_path = ei_tag + '.push_tmp.json'
    try:
        with open(push_tag_path, 'w', encoding='utf-8') as f:
            json.dump(tag, f, ensure_ascii=False, default=str)
        from clients.fed_client import FedClient
        caps = _collect_push_captures(enc['recording_id'])
        video_id = FedClient(fed).push_video(push_tag_path, captures=caps,
                                             capture_dir=_captures_dir(), src_files=src_files)
        _cleanup_pushed_captures(caps)
        return video_id
    finally:
        try:
            os.remove(push_tag_path)
        except OSError:
            pass
