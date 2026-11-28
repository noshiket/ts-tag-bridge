"""定数・状態の番号・エラーの記録・I/O の優先度"""

import json
import re
from ..common import logger
from .context import _update_recording_rollup
from .amz_logs import save_amz_log_on_error, _purge_tmp_on_error


# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

# Amatsukaze QueueState（item.state を .lower() したもの）の終了状態。
# 失敗は Failed / PreFailed（'error' という state は存在しない）。これらを取りこぼすと
# poll が無限ループして encode_error 化されないため、失敗系を網羅する。
_DONE_STATES = frozenset({'complete', 'failed', 'prefailed', 'canceled', 'error'})
# 終端のうち「やり直せば直るかもしれない」もの。complete は含めない
_FAILED_STATES = frozenset({'failed', 'prefailed', 'canceled', 'error'})

_PLACEHOLDER_RE = re.compile(r'\{\$(\w+)\}')
_FMT_EXT = {'MKV': '.mkv', 'MP4': '.mp4', 'TS': '.ts', 'M2TS': '.m2ts'}
_CONSOLE_PROGRESS_RE = re.compile(r'\[(\d+\.?\d*)%\]')

# state 番号マッピング
STATE_NUM = {
    'wait_encode': 0, 'make_DB': 1, 'split_ts': 2, 'encoding': 3,
    'encoded_analyze': 4, 'file_copy': 5, 'delete': 6, 'encode_end': 7,
}

# error_message にどの段階で失敗したかを付与するためのラベル
_STATE_LABEL = {
    'split_ts':        '分割(split_ts)',
    'encoding':        'エンコード(encoding)',
    'encoded_analyze': 'エンコード後解析(encoded_analyze)',
    'file_copy':       'コピー(file_copy)',
}


def _label_error(state: str, msg) -> str:
    """error_message に失敗段階のラベルを前置する（既に付与済みなら二重付与しない）。"""
    msg = '' if msg is None else str(msg)
    if msg.startswith('['):
        return msg
    return f'[{_STATE_LABEL.get(state, state)}] {msg}'


def _finalize_if_error(db, enc_id: int, stage: str, recording_id: int,
                      config: dict = None) -> bool:
    """直前のサブステップが error_message を残していれば、段階ラベルを付けて
    encode_error に確定し True を返す（呼び出し側は return する）。"""
    enc = db.get_encoding(enc_id)
    msg = enc.get('error_message') if enc else None
    if not msg:
        return False
    db.update_encoding(enc_id, state='encode_error', error_message=_label_error(stage, msg))
    _save_failed_state(db, enc_id, stage)
    # 作業ディレクトリを消すと原因が追えなくなるので、先にログを控える
    try:
        save_amz_log_on_error(db, enc_id, config)
    except Exception as e:
        logger.warning('enc_id=%d 失敗ログの保存に失敗(無視): %s', enc_id, e)
    _purge_tmp_on_error(db, enc_id, config)
    _update_recording_rollup(db, recording_id)
    logger.warning('run_one_encoding: enc_id=%d failed at %s: %s', enc_id, stage, msg)
    return True


def _save_failed_state(db, enc_id: int, stage: str) -> None:
    """どの工程で失敗したかを encode_info に残す。

    error_message のラベルにも入っているが、あれは人が読む文字列なので、
    やり直しの可否判定はこちらを見る。失敗した工程より先からやり直すと、
    その工程が作るはずの成果物が無い/壊れたまま進んでしまう。
    """
    if stage not in STATE_NUM:
        return
    enc = db.get_encoding(enc_id)
    if not enc:
        return
    try:
        encode_info = json.loads(enc.get('encode_info') or '{}')
    except (ValueError, TypeError):
        return
    if encode_info.get('failed_state') == stage:
        return
    encode_info['failed_state'] = stage
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
