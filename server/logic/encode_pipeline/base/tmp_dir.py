"""エンコードの一時フォルダ（中身を忘れる・空にする・消す・Amatsukaze から見た場所）"""

import json
import os
import shutil
from typing import Optional
from logic.storage.path_translator import container_to_host
from ..common import logger
from .context import _resolve_encode_context


def _forget_tmp_contents(db, enc_id: int, encode_info: dict) -> None:
    """tmp 作業ディレクトリを消したあと、その中身がまだ在ると言い張る印を落とす。

    trim.avs も amt_dir も tmp の中にある。印だけ残ると次回それらを「作成済み」と
    見なして飛ばし、Amatsukaze は trim を一切かけずに元TS全体を出力する。判るのは
    エンコード完了時（実測: 4時間かけて4時間49分ぶんを焼いた）。

    tmp を消す場所すべてから呼ぶこと。呼び忘れるとこの事故が再発する。
    """
    if not (encode_info.get('trim_avs_done')
            or encode_info.get('amz_item_id') is not None
            or encode_info.get('amz_cm_item_id') is not None):
        return
    encode_info['trim_avs_done'] = False
    encode_info['amz_item_id'] = None
    encode_info['amz_cm_item_id'] = None
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))


def _clear_tmp_dir(db, enc: dict, encode_info: dict, amz_vols: list, recreate: bool, who: str) -> None:
    """当該エンコードの tmp 作業ディレクトリ(.../tmp/<tmp_dirs>/)を安全に消す。
    cut.ts と output(mp4/tag.json/移動済みamt)を一掃し、中身の印(trim.avs 済み等)も落とす。
    recreate なら消した後に空で作り直す（作り直す側は、消さなかった時も作っておく）。

    安全ガード: tmp_dir は outputs.dstPath の親から導出し(input_ts は same_drive/trim で
    録画本体を指す場合があり、そこから導出すると録画フォルダを誤削除するため使わない)、
    basename が recordings.tmp_dirs(ユニークトークン)に含まれる場合のみ削除する。
    trim モードの cut.ts はソースTSへのリンクなので、削除してもソースTSは残る。
    """
    tmp_dir_amz = _tmp_dir_amz(encode_info)
    if not tmp_dir_amz:
        return
    tmp_dir_app = container_to_host(tmp_dir_amz, amz_vols)
    if not tmp_dir_app:
        return
    recording = db.get_recording(enc['recording_id'])
    tmp_dirs_raw = (recording or {}).get('tmp_dirs')
    tmp_dirs = json.loads(tmp_dirs_raw) if isinstance(tmp_dirs_raw, str) else (tmp_dirs_raw or [])
    if os.path.basename(tmp_dir_amz) not in tmp_dirs:
        logger.warning('%s: enc_id=%d skip (basename not in tmp_dirs): %s', who, enc['id'], tmp_dir_amz)
        if recreate:
            os.makedirs(tmp_dir_app, exist_ok=True)
        return
    if os.path.isdir(tmp_dir_app):
        shutil.rmtree(tmp_dir_app, ignore_errors=True)
        logger.info('%s: enc_id=%d removed %s', who, enc['id'], tmp_dir_app)
    if recreate:
        os.makedirs(tmp_dir_app, exist_ok=True)
    _forget_tmp_contents(db, enc['id'], encode_info)


def _purge_tmp_dir(db, enc: dict, encode_info: dict, amz_vols: list) -> None:
    """エンコード削除時に当該エンコードの tmp 作業ディレクトリを安全に削除する（_clear_tmp_dir）。"""
    _clear_tmp_dir(db, enc, encode_info, amz_vols, recreate=False, who='_purge_tmp_dir')


def _tmp_dir_amz(encode_info: dict) -> str:
    """作業フォルダ（Amatsukaze から見たパス）。outputs.dstPath の親。無ければ ''。
    input_ts は same_drive/trim で録画本体を指すことがあるので使わない。"""
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    dst_amz = ((outputs[0].get('dstPath', '') if outputs else '') or '').rstrip('/')
    return os.path.dirname(dst_amz) if dst_amz else ''


def _amz_vols_for_enc(db, enc: dict, config: dict) -> list:
    """そのエンコードの Amatsukaze のボリューム対応。録画のエンコード設定から決め、
    決まらなければ config の先頭の Amatsukaze サーバーのもの。"""
    recording = db.get_recording(enc['recording_id']) if enc.get('recording_id') else None
    if recording:
        ctx = _resolve_encode_context(recording, config)
        if ctx:
            return ctx['amz_vols']
    return ((config.get('amatsukaze_servers') or [{}])[0]).get('volumes', [])


def tmp_dir_for_enc(db, enc: dict, config: dict) -> Optional[str]:
    """そのエンコードの作業フォルダ(ホスト側のパス)。outputs.dstPath の親から割り出す。
    tmp_base 以外（録画詳細で直接指定した場所）に作ったものもこれで分かる。"""
    tmp_dir_amz = _tmp_dir_amz(json.loads(enc.get('encode_info') or '{}'))
    if not tmp_dir_amz:
        return None
    return container_to_host(tmp_dir_amz, _amz_vols_for_enc(db, enc, config)) or None


def purge_tmp_dir_for_enc(db, enc_id: int, config: dict) -> None:
    """エンコード削除時に tmp 作業ディレクトリを削除する（best-effort）。

    to_encode_info からエンコードコンテキスト(amz_vols)を解決して _purge_tmp_dir を呼ぶ。
    解決できない場合は config の先頭 Amatsukaze サーバーの volumes でフォールバックする。
    """
    enc = db.get_encoding(enc_id)
    if not enc:
        return
    encode_info = json.loads(enc.get('encode_info') or '{}')
    try:
        _purge_tmp_dir(db, enc, encode_info, _amz_vols_for_enc(db, enc, config))
    except Exception as e:
        logger.warning('purge_tmp_dir_for_enc: enc_id=%d failed: %s', enc_id, e)
