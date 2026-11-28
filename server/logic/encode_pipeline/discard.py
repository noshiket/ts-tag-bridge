"""エンコードの行を片付ける（Amatsukaze の項目・作業ディレクトリ・DB の行）"""

import json

from .common import (  # noqa: F401
    logger,
)
from .base.tmp_dir import purge_tmp_dir_for_enc  # noqa: F401
from .amatsukaze.amt_dir import purge_amz_item_for_retry  # noqa: F401


def discard_encoding(db, enc_id: int, config: dict, delete_row: bool = True, who: str = 'discard') -> None:
    """エンコードを片付ける: Amatsukaze の項目(Cancel→RemoveItem と amt*)→ 作業ディレクトリ → 行。

    項目は行に記録した番号(amz_item_id)で探すので、行を先に消すと Amatsukaze のキューに
    失敗のまま残り続ける（make_DB の作り直しで残骸になっていた）。必ずこの順で消す。
    delete_row=False なら行は残す（このあと作り直す呼び出し側が消す）。どれも best-effort。
    """
    enc = db.get_encoding(enc_id)
    if not enc:
        return
    try:
        info = json.loads(enc.get('encode_info') or '{}')
        # 正常に終わったもの(encode_end)は run_delete が項目を消し終えている
        if enc.get('state') != 'encode_end' and (
                info.get('amz_item_id') is not None or info.get('amz_cm_item_id') is not None):
            purge_amz_item_for_retry(db, enc_id, config)
    except Exception as e:
        logger.warning('%s: amz purge failed enc=%d: %s', who, enc_id, e)
    try:
        purge_tmp_dir_for_enc(db, enc_id, config)
    except Exception as e:
        logger.warning('%s: tmp_dir purge failed enc=%d: %s', who, enc_id, e)
    if delete_row:
        try:
            db.delete_encoding(enc_id)
        except Exception as e:
            logger.warning('%s: delete enc=%d failed: %s', who, enc_id, e)
