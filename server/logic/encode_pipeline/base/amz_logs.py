"""失敗した時の Amatsukaze のログを残す・消す・一時フォルダの片付け"""

import data_paths
import json
import os
from datetime import datetime
from ..common import logger
from .context import _resolve_encode_context
from .tmp_dir import purge_tmp_dir_for_enc


AMZ_LOG_DIR = os.path.join(data_paths.DATA_DIR, 'logs')


def amz_log_path(enc_id: int) -> str:
    """失敗したエンコードのログの置き場。"""
    return os.path.join(AMZ_LOG_DIR, f'enc_{enc_id}.log')


def save_amz_log_on_error(db, enc_id: int, config: dict) -> None:
    """失敗した Amatsukaze のログを server/data/logs に控える。

    作業ディレクトリは失敗時に消すので、そのままだと原因が追えない。
    実際これで「2時間24分かけてエンコードし終わった後、MP4 への多重化で
    ディスクが溢れて失敗」を突き止めるのに、コンテナのマウント先を辿る
    必要があった（Error writing data (No space left on device) /
    Exception thrown at Muxer.cpp:291）。

    ログ本文は Amatsukaze の API から取る。取れなければ error_message だけ残す。
    """
    enc = db.get_encoding(enc_id)
    if not enc:
        return
    try:
        os.makedirs(AMZ_LOG_DIR, exist_ok=True)
    except OSError as e:
        logger.warning('enc_id=%d ログの置き場を作れません: %s', enc_id, e)
        return

    head = [f'enc_id={enc_id}', f'recording_id={enc.get("recording_id")}',
            f'state={enc.get("state")}', f'保存時刻={datetime.now().isoformat(timespec="seconds")}',
            f'error_message={enc.get("error_message")}', '']
    body = ''
    try:
        from clients.amatsukaze_api.core import AmatsukazeClient
        recording = db.get_recording(enc.get('recording_id'))
        ctx = _resolve_encode_context(recording, config) if recording else None
        encode_info = json.loads(enc.get('encode_info') or '{}')
        src = encode_info.get('input_ts')
        if ctx and src:
            client = AmatsukazeClient(ctx['amz_url'])
            logs = client.get_encode_logs()
            items = logs if isinstance(logs, list) else (logs.get('items') or [])
            # 同じ作業ディレクトリで何度か走っていることがある（やり直し・中止）。
            # 並び順に頼らず、開始時刻がいちばん新しいものを採る。
            mine = [x for x in items if x.get('srcPath') == src]
            if mine:
                last = max(mine, key=lambda x: str(x.get('encodeStartDate') or ''))
                head.append(f'理由={last.get("reason")}')
                head.append(f'開始={last.get("encodeStartDate")}')
                got = client.get_log_file(encode_start=str(last.get('encodeStartDate') or '')[:23])
                if isinstance(got, dict):
                    body = got.get('content') or got.get('text') or ''
                elif isinstance(got, str):
                    body = got
    except Exception as e:
        head.append(f'（ログ本文を取れませんでした: {e}）')

    try:
        with open(amz_log_path(enc_id), 'w', encoding='utf-8') as f:
            f.write('\n'.join(head) + '\n' + (body or '（本文なし）'))
        logger.info('enc_id=%d 失敗時のログを控えました: %s', enc_id, amz_log_path(enc_id))
    except OSError as e:
        logger.warning('enc_id=%d ログを書けません: %s', enc_id, e)


def drop_amz_log(enc_id: int) -> None:
    """やり直しで再開する時に、前回の失敗ログを消す。"""
    try:
        os.remove(amz_log_path(enc_id))
        logger.info('enc_id=%d 前回の失敗ログを消しました', enc_id)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning('enc_id=%d 失敗ログを消せません: %s', enc_id, e)


def _purge_tmp_on_error(db, enc_id: int, config: dict) -> None:
    """失敗したエンコードの作業ディレクトリを消す。

    残しても誰も使わないのに、元TSと同じくらいの中間ファイルを抱えたまま居座る
    （実測 23GB の録画で 21GB）。リトライは必ず split_ts からやり直して作り直すので
    消してよい。失敗の理由は error_message に、ログは Amatsukaze 側に残る。
    """
    if not config:
        return
    try:
        purge_tmp_dir_for_enc(db, enc_id, config)
    except Exception as e:
        logger.warning('enc_id=%d 失敗した作業ディレクトリの削除に失敗: %s', enc_id, e)
