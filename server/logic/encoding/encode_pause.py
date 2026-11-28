"""エンコードの一時停止フラグ。

エンコードの実行は「interval ごとに未完了 encoding を1件選んで同期実行」する作りなので、
次の1本を取り出す前にこれを見るだけで

  停止 … 実行中のエンコードはそのまま完走し、以降は待機のまま新しく始めない
  再開 … 次の tick でキューの先頭から再開する

という挙動になる。実行中のものを殺さないのが要点（中断すると成果物が中途半端になり、
再開時の _verify_and_route のやり直しになる）。

サーバー再起動をまたいでも止めたままにしたいので、メモリではなくファイルに持つ。
"""

import data_paths  # server/ と server/data の場所
import json
import logging
import os

logger = logging.getLogger(__name__)

_FILE = os.path.join(data_paths.DATA_DIR, 'encode_pause.json')


def is_paused() -> bool:
    """停止中なら True。ファイルが無い/壊れている場合は「停止していない」とみなす。"""
    try:
        with open(_FILE, encoding='utf-8') as f:
            return bool(json.load(f).get('paused'))
    except FileNotFoundError:
        return False
    except (OSError, json.JSONDecodeError, AttributeError) as e:
        logger.warning('encode_pause: 読み込み失敗（停止していない扱い）: %s', e)
        return False


def set_paused(paused: bool) -> bool:
    """停止/再開を記録して、記録後の状態を返す。"""
    os.makedirs(os.path.dirname(_FILE), exist_ok=True)
    with open(_FILE, 'w', encoding='utf-8') as f:
        json.dump({'paused': bool(paused)}, f)
    logger.info('encode_pause: %s', '停止' if paused else '再開')
    return bool(paused)
