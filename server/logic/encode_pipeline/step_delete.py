"""Step 6: delete"""

import json
from .common import (  # noqa: F401
    logger,
)


# ===========================================================================
# Step 6: run_delete
# ===========================================================================

def run_delete(db, enc: dict, client, amz_vols: list) -> None:
    """
    Amatsukaze キューからタスク削除。将来的に残ファイル削除もここに追加。
    error_message がある場合は処理をスキップする。
    """
    enc_id = enc['id']
    db.update_encoding(enc_id, state='delete')

    encode_info = json.loads(enc.get('encode_info') or '{}')
    item_id = encode_info.get('amz_item_id')
    if item_id is not None:
        try:
            client.change_queue(item_id=item_id, change_type='RemoveItem')
            logger.debug('run_delete: RemoveItem enc_id=%d item_id=%d', enc_id, item_id)
        except Exception as e:
            logger.warning('run_delete: RemoveItem failed: %s', e)

    # trimモードの CMCheck item が残っていれば削除（通常は encoding 前段で削除済み）
    cm_item_id = encode_info.get('amz_cm_item_id')
    if cm_item_id is not None:
        try:
            client.change_queue(item_id=cm_item_id, change_type='RemoveItem')
            logger.debug('run_delete: RemoveItem(CMCheck) enc_id=%d item_id=%d', enc_id, cm_item_id)
        except Exception as e:
            logger.warning('run_delete: RemoveItem(CMCheck) failed: %s', e)

    logger.debug('run_delete: enc_id=%d complete', enc_id)
