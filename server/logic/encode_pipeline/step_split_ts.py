"""Step 2: split_ts"""

import json
import os
import shutil
from logic.storage.path_translator import container_to_host
from .common import (  # noqa: F401
    logger,
)
from .base.disk import free_bytes  # noqa: F401
from .trim.avs import _parse_trim_mode_segments  # noqa: F401
from .split_input import _split_input_ts  # noqa: F401
from .tmp_dirs import _reset_tmp_dir, _prepare_encode_dirs_and_tag, _link_source_ts, _move_to_next_tmp_base  # noqa: F401


# ---------------------------------------------------------------------------
# TS 分割ユーティリティ
# ---------------------------------------------------------------------------


def run_split_ts(db, enc: dict, source_ts_app: str, amz_vols: list, config: dict = None) -> None:
    """
    TS 分割を実行する。segments が NULL なら何もしない。
    分割した場合は encode_info.input_ts を分割ファイルのパスに更新する。

    冒頭で出力ディレクトリ作成と初期 tag.json 書き出し（旧 make_DB 分）を行う。
    """
    enc_id = enc['id']
    db.update_encoding(enc_id, state='split_ts')

    encode_info = json.loads(enc.get('encode_info') or '{}')
    # cut.ts を作り直すので、前回 tsreadex で直した印も外す（また断られたら直せるように）
    if encode_info.pop('ts_repaired', None):
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))

    # trim指定あり（trimモード）: 物理分割せずハードリンクにするため必要容量が変わる
    trim_spec = _parse_trim_mode_segments(enc.get('segments'))

    # tmp作業ディレクトリの空き容量チェック（cut.ts分割先とAmatsukaze出力先(outputs.dstPath)は
    # 同じtmpツリーに乗るため、input_tsの2倍未満ならここで打ち切り、ディスク枯渇による
    # 中途半端な失敗（分割済み・エンコード出力なし等）を避ける）。
    # trimモードは cut.ts がソースTSへのリンク（実体なし）なので、Amatsukaze の
    # 中間ファイルとエンコード出力ぶんの1倍でよい（実測 23GB のTSで i0.mpg 19.5GB +
    # audio.wav 3.5GB ≒ 元TSと同程度）。
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    dst_amz = (outputs[0].get('dstPath', '') if outputs else '') or ''
    if dst_amz and source_ts_app and os.path.exists(source_ts_app):
        tmp_dir_app = container_to_host(os.path.dirname(dst_amz.rstrip('/')), amz_vols)
        if tmp_dir_app:
            try:
                src_size = os.path.getsize(source_ts_app)
                need = src_size * (1 if trim_spec else 2)
                free = free_bytes(tmp_dir_app)
                if free < need and _move_to_next_tmp_base(db, enc, encode_info, amz_vols, tmp_dir_app,
                                                          need, free, config):
                    free = need   # 空きのある候補へ移した
                if free < need:
                    err = (f'tmp作業ディレクトリの空き容量不足'
                           f'（目安 {need / 1024 ** 3:.1f}GB必要 / 空き {free / 1024 ** 3:.1f}GB。'
                           f'作業ディレクトリの候補のどれにも空きがありません）')
                    db.update_encoding(enc_id, error_message=err)
                    logger.warning('run_split_ts: enc_id=%d %s', enc_id, err)
                    return
            except OSError as e:
                logger.warning('run_split_ts: enc_id=%d 容量チェック失敗（続行）: %s', enc_id, e)

    # 既存 tmp 作業ディレクトリを削除して作り直す（stale な cut.ts / output を一掃）
    _reset_tmp_dir(db, enc, encode_info, amz_vols)

    # 出力ディレクトリ作成 + 初期 tag.json（旧 make_DB から移設）
    _prepare_encode_dirs_and_tag(db, enc, encode_info, amz_vols)

    try:
        src_gb = os.path.getsize(source_ts_app) / (1024 ** 3) if source_ts_app and os.path.exists(source_ts_app) else 0
    except OSError:
        src_gb = 0
    logger.info('run_split_ts: enc_id=%d 分割開始 source=%s (%.1f GB) segments=%s',
                enc_id, os.path.basename(source_ts_app or ''), src_gb, enc.get('segments'))

    if trim_spec:
        # trimモード: 物理分割せず cut.ts をソースTSへのリンクにする。
        # 話ごとに tmp/<dir>/cut.ts が一意なので複数話trimでも Amatsukaze の
        # srcPath / {SrcPath}.trim.avs が衝突しない。CMカットは encoding 前段の
        # CMCheck→trim.avs（_run_cmcheck_and_write_trim）で Amatsukaze に任せる。
        input_ts_amz = encode_info.get('input_ts', '')
        tmp_dir_app = container_to_host(os.path.dirname(input_ts_amz), amz_vols)
        os.makedirs(tmp_dir_app, exist_ok=True)
        dst_app = os.path.join(tmp_dir_app, os.path.basename(input_ts_amz))
        if os.path.abspath(dst_app) != os.path.abspath(source_ts_app):
            how = _link_source_ts(source_ts_app, dst_app)
            logger.info('run_split_ts: enc_id=%d trimモード → %s %s', enc_id, how, dst_app)
        encode_info['trim_mode'] = True
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        return

    split_ts_amz = _split_input_ts(source_ts_app, enc, encode_info, amz_vols)

    if split_ts_amz:
        encode_info['input_ts'] = split_ts_amz
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        logger.info('run_split_ts: enc_id=%d input_ts updated to %s', enc_id, split_ts_amz)
    else:
        # segments 無し（単話・別ドライブ）: ソースTSを cut.ts へコピーして入力にする。
        # 同一ドライブの場合は make_DB で input_ts をソースTS直接参照にしている（input_ts が
        # 既存ファイルを指すため _verify_and_route の CHKSPLIT を通り、split_ts には来ない）。
        # よってここに到達するのは別ドライブ（input_ts=cut.ts が未生成）のときだけ。
        input_ts_amz = encode_info.get('input_ts', '')
        tmp_dir_app = container_to_host(os.path.dirname(input_ts_amz), amz_vols)
        os.makedirs(tmp_dir_app, exist_ok=True)
        dst_app = os.path.join(tmp_dir_app, os.path.basename(input_ts_amz))
        # 同一ドライブ最適化で input_ts がソースTS直参照になっている場合はコピー不要
        # (wait_encode は必ず split_ts から開始するためここに来る)。同一ファイルへの
        # copy2 は SameFileError になるのでスキップする
        if os.path.exists(dst_app) and os.path.samefile(source_ts_app, dst_app):
            logger.info('run_split_ts: enc_id=%d input_ts はソースTS直参照のためコピー不要', enc_id)
            return
        shutil.copy2(source_ts_app, dst_app)
        logger.info('run_split_ts: enc_id=%d no segments (cross drive) → copied source to %s', enc_id, dst_app)
