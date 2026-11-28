"""録画の受け取りと、エンコードの開始の知らせ（/api/fed/recording/*, /api/fed/encoding/*）"""

import asyncio
import json
import os
import shutil
import time
from quart import current_app, jsonify, request
from .common import (  # noqa: F401
    _gc_old_staging,
    _manifest_path,
    _safe_name,
    _safe_transfer_id,
    fed_bp,
    logger,
)
from .ingest import _abort_transfer, _receive_file  # noqa: F401
from .ingest_dedup import _meta_rest  # noqa: F401
from .recording_paths import _recording_staging_root, _find_existing_by_event


# ===========================================================================
# ノード委譲エンコード(録画転送型)
#   マスターの「<node>へ送信」キュー投入で、録画そのもの(TS+メタ)をスレーブへ転送する。
#   スレーブでは通常の録画として登録され、エンコード設定を自動反映して自動キュー投入。
#   以降は完全に通常のローカルエンコード(encode_dir='master' で成果物は既存 push で
#   マスターへ返送され、既存の _dedup_master_duplicates がマスター側の録画+TSを掃除する)。
#   POST /api/fed/recording/start → PUT .../file/<name> → POST .../finalize
#   POST /api/fed/encoding_started: スレーブがキュー投入した番組をマスターへ通知し、
#   マスター側の同一番組録画を waiting(<node>) 表記にする(どこで実行中か可視化)。
# ===========================================================================


@fed_bp.post('/recording/start')
async def recording_transfer_start():
    """他のサーバーから録画（TS 1本）を受け取り始める。body: {transfer_id, files, event?}。

    同じ番組の録画が既にあれば、送らずに済むことを返す。
    """
    body = await request.get_json()
    transfer_id = (body or {}).get('transfer_id')
    files = (body or {}).get('files')
    if not _safe_transfer_id(transfer_id):
        return jsonify({'error': 'transfer_id が不正です'}), 400
    if not isinstance(files, list) or len(files) != 1:
        return jsonify({'error': 'files はTS 1件のみ指定してください'}), 400
    f = files[0]
    if not isinstance(f, dict) or not _safe_name(f.get('name')) or not isinstance(f.get('size'), int):
        return jsonify({'error': f'不正なファイルエントリ: {f}'}), 400

    # 冪等/重複: 同一番組の録画が既にあれば転送不要(GB転送前に打ち切る)
    rule_db = current_app.config['RULE_DB']
    existing = await asyncio.to_thread(_find_existing_by_event, rule_db, (body or {}).get('event'))
    if existing:
        # 転送は要らないが、中身は埋める。前の転送が途中で落ちて行だけ残っていると、
        # ここで打ち切ったまま空の列が残り続ける（finalize へ進まないため）。
        # 既に値がある列は触らない＝向こうで手を入れたものを上書きしない。
        filled = []
        meta = (body or {}).get('meta')
        if isinstance(meta, dict):
            rest = await asyncio.to_thread(_meta_rest, rule_db, meta)
            gaps = {k: v for k, v in rest.items() if existing.get(k) in (None, '')}
            if gaps:
                await asyncio.to_thread(rule_db.update_recording, existing['id'], **gaps)
                filled = sorted(gaps)
                logger.info('fed recording: 既存 rec_id=%d の空き列を埋めた (%d列: %s)',
                            existing['id'], len(filled), ', '.join(filled))
        logger.info('fed recording: 同一番組の既存録画あり recordings.id=%d → 転送スキップ',
                    existing['id'])
        return jsonify({'ok': True,
                        'already': {'recording_id': existing['id'], 'filled': filled}})

    root = _recording_staging_root()
    await asyncio.to_thread(os.makedirs, root, exist_ok=True)
    await asyncio.to_thread(_gc_old_staging, root)
    try:
        free = shutil.disk_usage(root).free
    except OSError:
        free = None
    if free is not None and free < f['size'] * 2:
        return jsonify({'error': 'ディスク容量不足です'}), 507

    tdir = os.path.join(root, transfer_id)
    await asyncio.to_thread(os.makedirs, tdir, exist_ok=True)
    manifest = {'files': files, 'created_at': time.time()}
    await asyncio.to_thread(
        lambda: open(_manifest_path(tdir), 'w', encoding='utf-8').write(
            json.dumps(manifest, ensure_ascii=False)))
    return jsonify({'ok': True, 'transfer_id': transfer_id})


@fed_bp.put('/recording/<transfer_id>/file/<name>')
async def recording_transfer_put(transfer_id, name):
    """録画の受け取りで、TS を受け取る（本文がファイルの中身）。"""
    return await _receive_file(_recording_staging_root(), transfer_id, name)


@fed_bp.delete('/recording/<transfer_id>')
async def recording_transfer_abort(transfer_id):
    """録画の受け取りを取りやめ、受け取った途中のファイルを消す。"""
    return await _abort_transfer(_recording_staging_root(), transfer_id)


@fed_bp.post('/encoding_started')
async def encoding_started():
    """スレーブがエンコードキュー投入した番組の通知を受け、マスター側の同一番組録画を
    waiting(<node>) 表記にする(どこで実行中か可視化)。

    waiting(<node>) は waiting と同じ扱い(キュー投入可)。成果物がマスターに届いた際は
    既存の _dedup_master_duplicates で自動削除される(encodings 無し前提の従来条件のまま)。
    """
    body = await request.get_json() or {}
    node = str(body.get('node') or '')[:32]
    if not node:
        return jsonify({'error': 'node がありません'}), 400
    rule_db = current_app.config['RULE_DB']
    rec_id = await asyncio.to_thread(_mark_encoding_started_sync, rule_db, body, node)
    if rec_id:
        logger.info('fed encoding_started: recordings.id=%d → waiting(%s)', rec_id, node)
    return jsonify({'ok': True, 'marked': rec_id})


def _mark_encoding_started_sync(rule_db, event: dict, node: str):
    """同一番組のマスター側録画を waiting(<node>) 表記にする。対象外は None。"""
    existing = _find_existing_by_event(rule_db, event)
    if not existing:
        return None
    # エンコード済み/実行中の行や、状態が waiting 系以外の行は触らない
    if rule_db.get_encodings(existing['id']):
        return None
    state = existing.get('state') or ''
    if state != 'waiting' and not state.startswith('waiting('):
        return None
    rule_db.update_recording(existing['id'], state=f'waiting({node})')
    return existing['id']
