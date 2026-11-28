"""作業フォルダ(amt_dir)の割り出しと、やり直し前の片付け・トリムの区間"""

import json
import os
import re
import shutil
from typing import Optional
from logic.storage.path_translator import container_to_host
from ..common import (  # noqa: F401
    logger,
)
from ..base.context import _resolve_encode_context  # noqa: F401


def get_amt_dir_from_log_text(log_text: str, amz_volumes: list) -> Optional[str]:
    """Amatsukaze ログテキストから一時フォルダパスを抽出し、app パスに変換して返す。"""
    m = re.search(r'一時フォルダ: (.+)', log_text)
    if not m:
        return None
    amz_path = m.group(1).strip()
    return container_to_host(amz_path, amz_volumes)


def get_amt_dir(client, queue_item: dict, amz_volumes: list) -> Optional[str]:
    """完了済みキューアイテムのログから amt_dir を取得する。"""
    encode_start = queue_item.get('encodeStart')
    if not encode_start:
        return None
    result = client.get_log_file(encode_start=encode_start)
    log_text = result.get('content', '') if isinstance(result, dict) else str(result)
    return get_amt_dir_from_log_text(log_text, amz_volumes)


def purge_amz_item_for_retry(db, enc_id: int, config: dict) -> None:
    """手動リトライ(state=encoding)時に Amatsukaze の滞留 item + amt_dir を削除する。

    amz_item_id が未設定、またはキューに存在しない場合は no-op。
    失敗は best-effort（ログのみ）。amz_item_id のクリアだけは確実に行う。
    """
    from clients.amatsukaze_api.core import AmatsukazeClient

    enc = db.get_encoding(enc_id)
    if not enc:
        logger.warning('purge_amz_item_for_retry: enc_id=%d not found', enc_id)
        return

    encode_info = json.loads(enc.get('encode_info') or '{}')
    amz_item_id = encode_info.get('amz_item_id')
    amz_cm_item_id = encode_info.get('amz_cm_item_id')
    if amz_item_id is None and amz_cm_item_id is None:
        # trimモードの再実行は CMCheck からやり直す（trim.avs は _reset_tmp_dir が消す）
        if encode_info.get('trim_avs_done'):
            encode_info['trim_avs_done'] = False
            db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        logger.info('purge_amz_item_for_retry: enc_id=%d amz_item_id=None, skip', enc_id)
        return

    recording = db.get_recording(enc['recording_id'])
    if not recording:
        logger.warning('purge_amz_item_for_retry: enc_id=%d recording not found', enc_id)
        encode_info['amz_item_id'] = None
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        return

    ctx = _resolve_encode_context(recording, config)
    if not ctx:
        logger.warning('purge_amz_item_for_retry: enc_id=%d no encode context', enc_id)
        encode_info['amz_item_id'] = None
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        return

    client = AmatsukazeClient(ctx['amz_url'])
    amz_vols = ctx['amz_vols']

    # キューから対象 item（エンコード item と trimモードの CMCheck item）を探して掃除する
    items = []
    try:
        q = client.get_queue()
        items = q.get('items', []) or []
    except Exception as e:
        logger.warning('purge_amz_item_for_retry: get_queue failed: %s', e)

    for label, target_id, is_cm in (('encode', amz_item_id, False),
                                    ('CMCheck', amz_cm_item_id, True)):
        if target_id is None:
            continue
        found_item = next((it for it in items if it.get('id') == target_id), None)
        if found_item is None:
            logger.info('purge_amz_item_for_retry: %s item_id=%d not in queue, skip Cancel/Remove',
                        label, target_id)
            continue

        # amt_dir 取得（ログから。未開始なら None。CMCheck はチェックログ側）
        amt_dir = None
        try:
            if is_cm:
                amt_dir = _get_check_amt_dir(client, found_item,
                                             found_item.get('srcPath', ''), amz_vols)
            else:
                amt_dir = get_amt_dir(client, found_item, amz_vols)
        except Exception as e:
            logger.warning('purge_amz_item_for_retry: get_amt_dir(%s) failed: %s', label, e)

        # Cancel → RemoveItem
        for change_type in ('Cancel', 'RemoveItem'):
            try:
                client.change_queue(target_id, change_type)
                logger.info('purge_amz_item_for_retry: %s item_id=%d OK', change_type, target_id)
            except Exception as e:
                logger.warning('purge_amz_item_for_retry: %s item_id=%d failed: %s', change_type, target_id, e)

        # amt_dir 削除
        if amt_dir and os.path.exists(amt_dir):
            try:
                shutil.rmtree(amt_dir)
                logger.info('purge_amz_item_for_retry: removed amt_dir=%s', amt_dir)
            except Exception as e:
                logger.warning('purge_amz_item_for_retry: rmtree %s failed: %s', amt_dir, e)

    # id をクリアして run_encoding が再利用に入らないようにする。
    # trimモードは CMCheck からやり直す（trim.avs は _reset_tmp_dir が消す）
    encode_info['amz_item_id'] = None
    encode_info['amz_cm_item_id'] = None
    if encode_info.get('trim_avs_done'):
        encode_info['trim_avs_done'] = False
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
    logger.info('purge_amz_item_for_retry: enc_id=%d amz_item_id cleared', enc_id)


def _get_check_amt_dir(client, cm_item, input_ts: str, amz_vols: list) -> Optional[str]:
    """CMCheck 完了アイテムのチェックログから amt 一時フォルダ(appパス)を取得する。"""
    start = cm_item.get('encodeStart') if isinstance(cm_item, dict) else None
    if start:
        try:
            result = client.get_log_file(check_start=start)
            text = result.get('content', '') if isinstance(result, dict) else str(result)
            d = get_amt_dir_from_log_text(text, amz_vols)
            if d:
                return d
        except Exception as e:
            logger.warning('_get_check_amt_dir: check_start=%s ログ取得失敗: %s', start, e)
    # フォールバック: チェックログ一覧から srcPath 一致・最新の checkStartDate
    try:
        logs = client.get_check_logs() or []
        cands = [l for l in logs
                 if l.get('srcPath') == input_ts and l.get('checkStartDate')]
        cands.sort(key=lambda l: str(l['checkStartDate']))
        for l in reversed(cands):
            result = client.get_log_file(check_start=l['checkStartDate'])
            text = result.get('content', '') if isinstance(result, dict) else str(result)
            d = get_amt_dir_from_log_text(text, amz_vols)
            if d:
                return d
    except Exception as e:
        logger.warning('_get_check_amt_dir: チェックログ一覧からの取得失敗: %s', e)
    return None
