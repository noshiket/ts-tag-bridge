"""動画の取り込み（/api/fed/ingest/*）"""

import asyncio
import os
import shutil
from quart import jsonify, request
from .common import _safe_name, _safe_transfer_id, _staging_root, fed_bp
from .manifest import _load_manifest  # noqa: F401


async def _receive_file(root: str, transfer_id: str, name: str):
    """start で宣言したファイルを1つ受け取って root/<transfer_id>/<name> に置く。

    動画の取り込み(/ingest)と録画の受け取り(/recording)で同じ。.part に書いてから
    置き換えるので、途中で切れても半端なファイルは残らず、再PUTでも安全に上書きできる。
    """
    if not _safe_transfer_id(transfer_id) or not _safe_name(name):
        return jsonify({'error': '不正なパスです'}), 400
    tdir = os.path.join(root, transfer_id)
    manifest = await asyncio.to_thread(_load_manifest, tdir)
    if manifest is None:
        return jsonify({'error': 'transfer_id が見つかりません（start を先に呼んでください）'}), 404
    declared = {f['name']: f['size'] for f in manifest['files']}
    if name not in declared:
        return jsonify({'error': f'{name} は start で宣言されていません'}), 400

    part_path = os.path.join(tdir, name + '.part')
    final_path = os.path.join(tdir, name)
    written = 0
    try:
        with open(part_path, 'wb') as out:
            async for chunk in request.body:
                out.write(chunk)
                written += len(chunk)
    except OSError as e:
        if getattr(e, 'errno', None) == 28:  # ENOSPC
            return jsonify({'error': 'ディスク容量不足です'}), 507
        return jsonify({'error': f'書き込み失敗: {e}'}), 500

    if written != declared[name]:
        try:
            os.remove(part_path)
        except OSError:
            pass
        return jsonify({'error': f'サイズ不一致（期待 {declared[name]} / 受信 {written}）'}), 400

    os.replace(part_path, final_path)  # 再PUTでも安全に上書き
    return jsonify({'ok': True, 'name': name, 'size': written})


async def _abort_transfer(root: str, transfer_id: str):
    """受け取りの途中のものを root/<transfer_id> ごと捨てる。"""
    if not _safe_transfer_id(transfer_id):
        return jsonify({'error': '不正な transfer_id です'}), 400
    await asyncio.to_thread(shutil.rmtree, os.path.join(root, transfer_id), True)
    return jsonify({'ok': True})


@fed_bp.put('/ingest/<transfer_id>/file/<name>')
async def ingest_put_file(transfer_id, name):
    """動画の受け取りで、ファイルを1つ受け取る（本文がファイルの中身）。"""
    return await _receive_file(_staging_root(), transfer_id, name)


@fed_bp.delete('/ingest/<transfer_id>')
async def ingest_abort(transfer_id):
    """動画の受け取りを取りやめ、受け取った途中のファイルを消す。"""
    return await _abort_transfer(_staging_root(), transfer_id)


