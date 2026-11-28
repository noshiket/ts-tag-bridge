"""エンコードの進み具合を追う・作業フォルダを集める"""

import json
import os
import shutil
from logic.storage.path_translator import container_to_host
from .common import logger
from .amatsukaze.repair import _repair_too_small_ts
from .amatsukaze.queue import amatsukaze_add_queue
from .amatsukaze.poll import amatsukaze_poll_complete
from .amatsukaze.amt_dir import get_amt_dir


def _poll_encoding(db, enc, encode_info, client, item_id, amz_vols, stop_event):
    """完了まで見張る（進捗を DB に保存）。映像が小さすぎて失敗した TS は直して1回だけ入れ直す。"""
    enc_id = enc['id']
    # アプリログにも 5% 刻みで進捗を出す（エンコード中の長い無音区間を避け、進行が見えるようにする）。
    _last_logged = {'pct': -5}

    def _on_progress(prog):
        db.update_encoding(enc_id, progress=prog)
        pct = int((prog or 0) * 100)
        if pct >= _last_logged['pct'] + 5:
            _last_logged['pct'] = pct - (pct % 5)
            logger.debug('run_encoding: enc_id=%d encoding %d%% (item_id=%s)', enc_id, pct, item_id)

    def _poll():
        return amatsukaze_poll_complete(
            client, item_id, stop_event=stop_event, on_progress=_on_progress,
            should_abort=lambda: db.get_encoding(enc_id) is None,
            amz_volumes=amz_vols,
        )

    try:
        return _poll()
    except RuntimeError as e:
        if not _repair_too_small_ts(db, enc, encode_info, client, item_id, e, amz_vols):
            raise
        item_id = amatsukaze_add_queue(client, encode_info)
        encode_info['amz_item_id'] = item_id
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        if item_id is None:
            raise RuntimeError(f'amatsukaze_add_queue: item_id not found for enc_id={enc_id}')
        return _poll()


def _collect_amt_dir(db, enc_id, encode_info, client, queue_item, amz_vols):
    """作業フォルダ(amt_dir)を見つけて encode_info に記録し、outputs.dstPath へ移す。"""
    amt_dir_app = None
    try:
        amt_dir_app = get_amt_dir(client, queue_item, amz_vols)
    except Exception as e:
        logger.warning('run_encoding: get_amt_dir failed: %s', e)
    if not amt_dir_app:
        amt_dir_app = encode_info.get('amt_dir') or None
    if not amt_dir_app:
        logger.warning('run_encoding: amt_dir not found for enc_id=%d', enc_id)
        return

    encode_info['amt_dir'] = amt_dir_app
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))

    # amt_dir を outputs.dstPath に移動
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    if outputs:
        dst_amz = outputs[0].get('dstPath', '').rstrip('/')
        dst_app = container_to_host(dst_amz, amz_vols)
        if dst_app:
            new_amt_dir_app = os.path.join(dst_app, os.path.basename(amt_dir_app))
            try:
                shutil.move(amt_dir_app, new_amt_dir_app)
                logger.info('run_encoding: amt_dir moved %s → %s', amt_dir_app, new_amt_dir_app)
                encode_info['amt_dir'] = new_amt_dir_app
                db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
            except Exception as e:
                logger.warning('run_encoding: amt_dir move failed: %s', e)
