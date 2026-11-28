"""キューへの追加・完了の見張り・失敗の理由"""

import os
import shutil
import time
from typing import Optional
from ..common import (  # noqa: F401
    logger,
)


# ---------------------------------------------------------------------------
# Amatsukaze キュー追加・監視
# ---------------------------------------------------------------------------

def amatsukaze_add_queue(client, encode_info: dict) -> Optional[int]:
    """
    Amatsukaze キューにファイルを追加し item_id を返す。

    Returns:
        item_id (見つからなければ None)
    """
    input_ts = encode_info['input_ts']
    outputs  = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]

    try:
        before = client.get_queue()
        before_ids = frozenset(
            item['id'] for item in (before.get('items', []) or []) if 'id' in item
        )
    except Exception as e:
        logger.warning('amatsukaze_add_queue: pre-snapshot get_queue failed: %s', e)
        before_ids = frozenset()

    client.add_queue(
        targets=[{'path': input_ts, 'hash': None}],
        outputs=outputs,
        mode=encode_info.get('mode', 'Batch'),
        add_queue_bat=encode_info.get('add_queue_bat') or None,
    )
    logger.info('amatsukaze_add_queue: input_ts=%s', input_ts)

    item_id = None
    for attempt in range(10):
        try:
            after = client.get_queue()
            after_items = after.get('items', []) if isinstance(after, dict) else []
            for item in after_items:
                if item.get('id') not in before_ids and item.get('srcPath') == input_ts:
                    item_id = item['id']
                    break
        except Exception as e:
            logger.warning('amatsukaze_add_queue: get_queue error: %s', e)

        if item_id is not None:
            logger.debug('amatsukaze_add_queue: item_id=%d (attempt %d)', item_id, attempt)
            break
        time.sleep(3)

    if item_id is None:
        logger.warning('amatsukaze_add_queue: item_id not found')

    return item_id


def amz_failure_reason(client, item: dict) -> str:
    """失敗したキューアイテムの理由を、できるだけ具体的に組み立てて返す。

    item の stateDetailText は「Amatsukaze.exeはコード1で終了しました。」程度しか
    入らないので、実際の原因はログの [error] 行から拾う。原典の書式は

        AMT [error] Exception thrown at CMAnalyze.cpp:428
        Message: logo scan #0: Could not find video stream ...

    のように次の行に本文が続くので、その組で取る。取れなければ空文字。
    """
    parts = []
    detail = (item.get('stateDetailText') or '').strip().strip('/').strip()
    if detail:
        parts.append(detail)

    encode_start = item.get('encodeStart')
    if encode_start:
        try:
            result = client.get_log_file(encode_start=encode_start)
            text = result.get('content', '') if isinstance(result, dict) else str(result)
            lines = text.splitlines()
            errs = []
            for i, line in enumerate(lines):
                if '[error]' in line:
                    errs.append(line.strip())
                    for nxt in lines[i + 1:i + 3]:
                        if nxt.strip().startswith('Message:'):
                            errs.append(nxt.strip())
                            break
            if errs:
                parts.append(' / '.join(errs[-4:]))   # 最後の失敗だけで十分
        except Exception as e:
            logger.warning('amz_failure_reason: get_log_file failed: %s', e)

    return ' / '.join(parts)[:1000]   # error_message は一覧にも出るので上限を切る


def remove_amt_dir(amt_dir) -> Optional[str]:
    """Amatsukaze の作業フォルダ(amt*)を消す。消したパスを返す（消さなければ None）。

    ログの解釈違いで実データを飛ばさないよう、amt* 形式のディレクトリに限る。
    """
    if not amt_dir or not os.path.basename(amt_dir).startswith('amt') or not os.path.isdir(amt_dir):
        return None
    try:
        shutil.rmtree(amt_dir)
        logger.info('remove_amt_dir: removed %s', amt_dir)
        return amt_dir
    except OSError as e:
        logger.warning('remove_amt_dir: rmtree %s failed: %s', amt_dir, e)
        return None
