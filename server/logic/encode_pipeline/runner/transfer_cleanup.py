"""送り出した後の知らせと一時フォルダの片付け"""

import os
import shutil
from logic.storage.path_translator import container_to_host
from ..common import logger


def _notify_encoding_started(recording: dict, config: dict) -> None:
    """エンコードキュー投入をライブラリサーバー(マスター)へ通知する。best-effort。

    マスター側に同一番組の録画があれば waiting(<node>) 表記になり、どこで実行中か
    分かる。federation送信側(library_peer設定あり=スレーブ)のみ動作する。
    """
    fed = config.get('federation') or {}
    if not (fed.get('library_peer') or {}).get('url'):
        return
    keys = ('onid', 'tsid', 'sid', 'eid', 'eit_start_time')
    event = {k: recording.get(k) for k in keys}
    if any(v in (None, '') for v in event.values()):
        return
    event['node'] = fed.get('node_id') or 'slave'
    try:
        from clients.fed_client import FedClient
        FedClient(fed).notify_encoding_started(event)
    except Exception as e:
        logger.debug('_notify_encoding_started: 通知失敗(無視): %s', e)


def _delete_tmp_dirs_physical(tokens: list, ctx: dict) -> None:
    """tmp_dirs トークンの物理ディレクトリを削除する（再生成で不要になった旧 tmp の掃除）。

    preset.input_ts の {$tmp_dirs} をトークンで置換して tmp ディレクトリを特定する。
    安全ガード: basename がトークンに一致する場合のみ削除する。
    """
    preset = ctx.get('encode_preset_tpl') or {}
    input_ts_tpl = preset.get('input_ts', '')
    if not input_ts_tpl or '{$tmp_dirs}' not in input_ts_tpl:
        return
    amz_vols = ctx.get('amz_vols', [])
    for tok in tokens:
        if not tok:
            continue
        ts_amz = input_ts_tpl.replace('{$tmp_dirs}', str(tok))
        tmp_dir_amz = os.path.dirname(ts_amz)
        if os.path.basename(tmp_dir_amz) != str(tok):
            continue
        tmp_dir_app = container_to_host(tmp_dir_amz, amz_vols)
        if tmp_dir_app and os.path.isdir(tmp_dir_app):
            shutil.rmtree(tmp_dir_app, ignore_errors=True)
            logger.info('_delete_tmp_dirs_physical: removed %s', tmp_dir_app)
