"""受け取った動画を仕上げる（置く・登録する・録画とつなぐ）"""

import data_paths
import asyncio
import json
import os
import shutil
import uuid
from quart import current_app, jsonify, request
from logic.encode_pipeline.file_copy_steps import _pick_available_encode_dir
from logic.storage.mount_point import get_mount_point, safe_makedirs
from clients.fed_client import CAPTURE_PREFIX as _CAPTURE_PREFIX
from .common import _safe_transfer_id, _staging_root, fed_bp, logger
from .ingest_dedup import _dedup_master_duplicates
from .manifest import _load_manifest


def _finalize_sync(cfg: dict, rule_db, video_db, tdir: str, manifest: dict, tag: dict,
                   captures_meta: list = None):
    """finalize の重い同期IO部分。asyncio.to_thread から呼ばれる。"""
    files = manifest['files']
    staged_names = {f['name'] for f in files}
    for f in files:
        p = os.path.join(tdir, f['name'])
        if not os.path.exists(p):
            raise FileNotFoundError(f'{f["name"]} が未転送です')

    app_output_path = tag.get('app_output_path')
    if not app_output_path:
        raise ValueError('tag に app_output_path がありません')
    mp4_name = os.path.basename(app_output_path)
    thumb_path = tag.get('thumbnail_path')
    tile_path = tag.get('thumbnail_tile_path')
    thumb_name = os.path.basename(thumb_path) if thumb_path else None
    tile_name = os.path.basename(tile_path) if tile_path else None
    tag_name = mp4_name + '.tag.json'

    for required in (mp4_name, tag_name):
        if required not in staged_names:
            raise FileNotFoundError(f'{required} が転送ファイルに含まれていません')
    for optional_name in (thumb_name, tile_name):
        if optional_name and optional_name not in staged_names:
            raise FileNotFoundError(f'{optional_name} が転送ファイルに含まれていません')

    # フォルダ名は text_parser の setPath と同じ規則でパス表記へ直す。
    # basename() で切ると 'ねこま1/2' が '2' になり、別のフォルダへ入ってしまう
    # （DB上のフォルダ名は '/' を含むことがあり、ディスク上は '／' で書く）。
    # sanitize_path_component は区切り文字を全部潰すので、パス抜けの防止にもなる。
    from text_parser.paths import sanitize_path_component
    folder = sanitize_path_component(str(tag.get('folder') or ''))

    # --- 冪等性: 既存の同一パスがあればそのディスクを再利用する ---
    dest_dir = None
    for cand in (cfg.get('encode_dir_list') or []):
        p = os.path.join(cand, folder, mp4_name)
        if os.path.exists(p):
            dest_dir = os.path.join(cand, folder)
            break
    if dest_dir is None:
        chosen = _pick_available_encode_dir(rule_db, cfg)
        if not chosen:
            raise RuntimeError('利用可能な encode_dir がありません')
        dest_dir = os.path.join(chosen, folder)
    encode_dir = os.path.dirname(dest_dir) if folder else dest_dir

    dest_mp4 = os.path.join(dest_dir, mp4_name)
    try:
        safe_makedirs(dest_mp4)
    except ValueError as e:
        raise RuntimeError(f'転送先が未マウント/作成不可: {e}')

    src_mp4 = os.path.join(tdir, mp4_name)
    src_size = os.path.getsize(src_mp4)
    free = shutil.disk_usage(dest_dir).free
    if free < src_size * 1.1:
        raise RuntimeError(f'空き容量不足（必要 {src_size} / 空き {free}）')

    dest_tag = dest_mp4 + '.tag.json'
    dest_thumb = os.path.join(dest_dir, thumb_name) if thumb_name else None
    dest_tile = os.path.join(dest_dir, tile_name) if tile_name else None

    moved = []
    try:
        shutil.move(src_mp4, dest_mp4); moved.append(dest_mp4)
        if os.path.getsize(dest_mp4) != src_size:
            raise IOError('移動後サイズ不一致')
        shutil.move(os.path.join(tdir, tag_name), dest_tag); moved.append(dest_tag)
        if thumb_name:
            shutil.move(os.path.join(tdir, thumb_name), dest_thumb); moved.append(dest_thumb)
        if tile_name:
            shutil.move(os.path.join(tdir, tile_name), dest_tile); moved.append(dest_tile)
    except Exception:
        for f in moved:
            try:
                os.remove(f)
            except OSError:
                pass
        raise

    # --- tag.json のパス系フィールドをライブラリローカル値へ書換 ---
    new_tag = dict(tag)
    new_tag['app_output_path'] = dest_mp4
    new_tag['encode_dir'] = encode_dir
    if dest_thumb:
        new_tag['thumbnail_path'] = dest_thumb
    if dest_tile:
        new_tag['thumbnail_tile_path'] = dest_tile
    try:
        new_tag['recording_device'] = get_mount_point(dest_dir)
    except Exception:
        pass
    with open(dest_tag, 'w', encoding='utf-8') as f:
        json.dump(new_tag, f, ensure_ascii=False, indent=2, default=str)

    from api.routes.tag_io import _remap_watch_history_video
    video_id = video_db.add_videos(dest_tag, replace=True, on_replace=_remap_watch_history_video)

    # --- キャプチャ画像の取込（任意・best-effort。失敗しても動画登録は成立させる） ---
    # 送信側の data/captures/ にあった画像を CAPTURE_PREFIX 付きで受信しているので、
    # こちらの data/captures/ へ移して新しい video_id に紐づけて登録する。
    for meta in (captures_meta or []):
        try:
            fname = os.path.basename(str(meta.get('path') or ''))
            staged = os.path.join(tdir, _CAPTURE_PREFIX + fname)
            if not fname or not os.path.exists(staged):
                continue
            cap_dir = os.path.abspath(os.path.join(data_paths.DATA_DIR, 'captures'))
            os.makedirs(cap_dir, exist_ok=True)
            dest_name = fname
            if os.path.exists(os.path.join(cap_dir, dest_name)):
                stem, ext = os.path.splitext(fname)
                dest_name = f'{stem}_{uuid.uuid4().hex[:8]}{ext}'
            shutil.move(staged, os.path.join(cap_dir, dest_name))
            video_db.add_capture(
                dest_name, video_id=video_id,
                tot=meta.get('tot'), onid=meta.get('onid'), tsid=meta.get('tsid'),
                sid=meta.get('sid'), eid=meta.get('eid'),
                eit_title=meta.get('eit_title'), eit_description=meta.get('eit_description'),
                eit_extended_info=meta.get('eit_extended_info'),
                eit_start_time=meta.get('eit_start_time'), eit_end_time=meta.get('eit_end_time'),
                eit_station_name=meta.get('eit_station_name'), owner=meta.get('owner'))
        except Exception as e:
            logger.warning('fed finalize: キャプチャ取込失敗 %s: %s', meta.get('path'), e)

    # --- 地域ドロップ対策: マスター側にある同一番組の重複録画を削除（best-effort。
    #     失敗しても動画登録は成立させる） ---
    try:
        _dedup_master_duplicates(rule_db, tag)
    except Exception as e:
        logger.warning('fed dedup failed: %s', e)

    shutil.rmtree(tdir, ignore_errors=True)
    return video_id, dest_mp4


@fed_bp.post('/ingest/<transfer_id>/finalize')
async def ingest_finalize(transfer_id):
    """受け取った動画をライブラリへ登録する。body: {tag（tag.json の中身）, captures?}。"""
    if not _safe_transfer_id(transfer_id):
        return jsonify({'error': '不正な transfer_id です'}), 400
    body = await request.get_json()
    tag = (body or {}).get('tag')
    if not isinstance(tag, dict):
        return jsonify({'error': 'tag が不正です'}), 400
    captures_meta = (body or {}).get('captures')
    if captures_meta is not None and not isinstance(captures_meta, list):
        return jsonify({'error': 'captures が不正です'}), 400

    tdir = os.path.join(_staging_root(), transfer_id)
    manifest = await asyncio.to_thread(_load_manifest, tdir)
    if manifest is None:
        return jsonify({'error': 'transfer_id が見つかりません'}), 404

    cfg = current_app.config['ENCODE_AUTO']
    rule_db = current_app.config['RULE_DB']
    video_db = current_app.config['VIDEO_DB']
    try:
        video_id, dest_path = await asyncio.to_thread(
            _finalize_sync, cfg, rule_db, video_db, tdir, manifest, tag, captures_meta)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 409
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 507
    except Exception as e:
        logger.warning('fed finalize failed transfer_id=%s: %s', transfer_id, e)
        return jsonify({'error': str(e)}), 500

    logger.info('fed finalize: transfer_id=%s video_id=%s path=%s', transfer_id, video_id, dest_path)
    return jsonify({'video_id': video_id, 'path': dest_path})
