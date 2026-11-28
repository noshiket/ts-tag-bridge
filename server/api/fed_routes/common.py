"""Blueprint(fed_bp)・認証・受け取りの置き場とファイルの確かめ"""

import data_paths  # server/ と server/data の場所
import asyncio
import json
import logging
import os
import shutil
import time
from typing import Optional
from quart import Blueprint, current_app, jsonify, request
from clients.fed_client import CAPTURE_PREFIX as _CAPTURE_PREFIX


logger = logging.getLogger('api.fed_routes')   # 分ける前と同じ名前で出す

fed_bp = Blueprint('fed', __name__, url_prefix='/api/fed')

_STAGING_GC_AGE = 24 * 3600  # 24時間超の未完了ステージングを掃除
_TRANSFER_ID_RE_MAXLEN = 64

# tag.json / サムネ2種の既知suffix。それ以外の1ファイルが動画本体(mp4)とみなされる。
# CAPTURE_PREFIX付きはキャプチャ画像(0個以上、任意)。
_TAG_SUFFIX = '.tag.json'
_THUMB_SUFFIX = '.thumbnail.webp'
_TILE_SUFFIX = '.thumbnail_tile.webp'
_KNOWN_SUFFIXES = (_TAG_SUFFIX, _THUMB_SUFFIX, _TILE_SUFFIX)


def _classify_file(name: str) -> str:
    if name.startswith(_CAPTURE_PREFIX):
        return 'capture'
    for suf in _KNOWN_SUFFIXES:
        if name.endswith(suf):
            return suf
    return 'main'


def _validate_file_set(files: list) -> Optional[str]:
    """動画一式(mp4本体1 + tag.json1 + サムネ2種は任意 + キャプチャ任意個)であることを
    検証する。不正なら理由文字列を返す（正常なら None）。"""
    kinds = [_classify_file(f['name']) for f in files]
    if kinds.count('main') != 1:
        return 'mp4本体（既知suffix以外）は1つだけ指定してください'
    if kinds.count(_TAG_SUFFIX) != 1:
        return f'{_TAG_SUFFIX} は1つだけ指定してください'
    if kinds.count(_THUMB_SUFFIX) > 1 or kinds.count(_TILE_SUFFIX) > 1:
        return 'サムネイルはそれぞれ1つまでです'
    if len(kinds) - kinds.count('capture') > 4:
        return 'ファイル数が多すぎます（最大4: mp4/tag.json/サムネ2種 + キャプチャ）'
    return None


@fed_bp.before_request
async def _require_fed_token():
    from logic.federation import fed_auth
    if not fed_auth.verify(current_app.config['ENCODE_AUTO'],
                           request.headers.get('X-Fed-Token', '')):
        return jsonify({'error': 'Unauthorized'}), 401
    return None


def _staging_root() -> str:
    cfg = current_app.config['ENCODE_AUTO']
    base = cfg.get('tmp_base') or data_paths.DATA_DIR
    return os.path.join(base, 'fed_ingest')


def _safe_name(name: str) -> bool:
    """パストラバーサル対策: ベース名のみを許可する。"""
    if not name or not isinstance(name, str):
        return False
    if name in ('.', '..'):
        return False
    return os.path.basename(name) == name


def _safe_transfer_id(tid: str) -> bool:
    if not tid or not isinstance(tid, str) or len(tid) > _TRANSFER_ID_RE_MAXLEN:
        return False
    return all(c.isalnum() or c in '-_' for c in tid)


def _gc_old_staging(root: str) -> None:
    """24時間超放置されたステージングディレクトリを掃除する（best-effort）。"""
    try:
        entries = os.listdir(root)
    except OSError:
        return
    now = time.time()
    for name in entries:
        path = os.path.join(root, name)
        try:
            if now - os.path.getmtime(path) > _STAGING_GC_AGE:
                shutil.rmtree(path, ignore_errors=True)
                logger.info('fed_ingest: 期限切れステージングを削除: %s', path)
        except OSError:
            continue


def _manifest_path(tdir: str) -> str:
    return os.path.join(tdir, 'manifest.json')


@fed_bp.get('/ping')
async def ping():
    """サーバー同士のつながりの確かめ。自分の node_id を返す。"""
    fed = (current_app.config['ENCODE_AUTO'].get('federation') or {})
    return jsonify({'ok': True, 'node_id': fed.get('node_id')})


@fed_bp.get('/videos_index')
async def videos_index():
    """全videoの重複表示用コンパクト索引を返す。スレーブが録画一覧の重複表示
    (recordingsの確定値とマスター側videoの照合)のために取得する。"""
    video_db = current_app.config['VIDEO_DB']
    items = await asyncio.to_thread(video_db.list_episode_index)
    return jsonify(items)


@fed_bp.post('/ingest/start')
async def ingest_start():
    """他のサーバーから動画を受け取り始める。body: {transfer_id, files: [{name, size}]}。

    このあと PUT .../file/<name> でファイルを送り、POST .../finalize でライブラリへ登録する。
    """
    body = await request.get_json()
    transfer_id = (body or {}).get('transfer_id')
    files = (body or {}).get('files')
    if not _safe_transfer_id(transfer_id):
        return jsonify({'error': 'transfer_id が不正です'}), 400
    if not isinstance(files, list) or not files:
        return jsonify({'error': 'files が空です'}), 400
    for f in files:
        if not isinstance(f, dict) or not _safe_name(f.get('name')) or not isinstance(f.get('size'), int):
            return jsonify({'error': f'不正なファイルエントリ: {f}'}), 400
    invalid_reason = _validate_file_set(files)
    if invalid_reason:
        return jsonify({'error': invalid_reason}), 400

    root = _staging_root()
    await asyncio.to_thread(os.makedirs, root, exist_ok=True)
    await asyncio.to_thread(_gc_old_staging, root)

    tdir = os.path.join(root, transfer_id)
    await asyncio.to_thread(os.makedirs, tdir, exist_ok=True)
    manifest = {'files': files, 'created_at': time.time()}
    await asyncio.to_thread(
        lambda: open(_manifest_path(tdir), 'w', encoding='utf-8').write(
            json.dumps(manifest, ensure_ascii=False)))
    return jsonify({'ok': True, 'transfer_id': transfer_id})
