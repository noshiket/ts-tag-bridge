"""encodings の整合性の確認と、成果物から再開する確認"""

import os
from logic.storage.path_translator import container_to_host
from .common import (  # noqa: F401
    _apply_encode_dir,
    logger,
)
from .base.states import STATE_NUM  # noqa: F401
from .placeholders import (  # noqa: F401
    _get_ei_tag_path,
)


# ===========================================================================
# PRECHECK: encodings 整合性確認
# ===========================================================================

def _precheck_ok(db, recording_id: int) -> bool:
    """
    recording_id に一致する encodings が存在し、
    episode_count が全件一致、episode_idx が全件セット済みかを確認する。
    """
    encs = db.get_encodings(recording_id)
    if not encs:
        return False
    counts = {e.get('episode_count') for e in encs}
    if len(counts) != 1 or None in counts:
        return False
    expected_count = counts.pop()
    if expected_count != len(encs):
        return False
    idxs = {e.get('episode_idx') for e in encs}
    if None in idxs:
        return False
    return True


# ===========================================================================
# CHKSTATE: アーティファクト検証チェーン
# ===========================================================================

def _state_num(enc: dict) -> int:
    """encoding の state を番号に変換する。"""
    return STATE_NUM.get(enc.get('state', 'wait_encode'), 0)


def _verify_and_route(db, enc: dict, encode_info: dict, amz_vols: list) -> int:
    """
    encoding のアーティファクトを検証し、実行すべき state 番号を返す。
    フローチャートの CHKSTATE チェーンに対応。
    """
    enc_id = enc['id']
    current = _state_num(enc)

    # --- CHKSTATE2: split_ts ---
    # wait_encode / make_DB（=キューから初めて dispatch される行）は必ず split_ts から
    # 開始する。ここで CHKSPLIT に進むと、再キューで tmp に残った古い cut.ts を
    # 再利用して split_ts をスキップしてしまうため、artifact 検証より前に確定させる。
    # run_split_ts 冒頭の _reset_tmp_dir が古い tmp を掃除して再分割する。
    if current <= STATE_NUM['split_ts']:
        if current < STATE_NUM['split_ts']:
            db.update_encoding(enc_id, state='split_ts')
        return STATE_NUM['split_ts']

    # CHKSPLIT: input_ts が代入済みか、ディレクトリ・分割ファイルが存在するか
    input_ts_amz = encode_info.get('input_ts', '')
    tmp_dir_amz = os.path.dirname(input_ts_amz)
    tmp_dir_app = container_to_host(tmp_dir_amz, amz_vols)
    split_file = os.path.join(tmp_dir_app, os.path.basename(input_ts_amz)) if tmp_dir_app else ''
    if not split_file or not os.path.exists(split_file):
        logger.info('_verify_and_route: enc_id=%d split file missing, route to split_ts', enc_id)
        db.update_encoding(enc_id, state='split_ts')
        return STATE_NUM['split_ts']

    # --- CHKSTATE3: encoding ---
    if current == STATE_NUM['encoding']:
        return STATE_NUM['encoding']

    # CHKAMT: amt_dir 存在 + outputs.dstPath あり
    amt_dir_app = encode_info.get('amt_dir')
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    has_dst = bool(outputs and outputs[0].get('dstPath'))
    if not amt_dir_app or not os.path.exists(amt_dir_app) or not has_dst:
        logger.info('_verify_and_route: enc_id=%d amt_dir/dstPath missing, route to encoding', enc_id)
        db.update_encoding(enc_id, state='encoding')
        return STATE_NUM['encoding']

    # --- CHKSTATE4: encoded_analyze ---
    if current == STATE_NUM['encoded_analyze']:
        return STATE_NUM['encoded_analyze']

    # CHKTRIM: trim_segments あり + 一次ファイル tag.json（encode_info 由来）あり
    trim_segs_raw = enc.get('trim_segments')
    ei_tag = _get_ei_tag_path(encode_info, amz_vols)
    if not trim_segs_raw or not ei_tag or not os.path.exists(ei_tag):
        logger.info('_verify_and_route: enc_id=%d trim/ei_tag missing, route to encoded_analyze', enc_id)
        db.update_encoding(enc_id, state='encoded_analyze')
        return STATE_NUM['encoded_analyze']

    # --- CHKSTATE5: file_copy ---
    if current == STATE_NUM['file_copy']:
        return STATE_NUM['file_copy']

    # CHKFILES: コピー先 tag_json（encodings.tag_json）+ app_output_path ファイルあり
    # app_output_path / tag_json はリテラル {$encode_dir} を含むため encode_dir で解決して確認する
    app_out = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir'))
    tag_json = _apply_encode_dir(enc.get('tag_json'), enc.get('encode_dir'))
    if not app_out or not os.path.exists(app_out) or not tag_json or not os.path.exists(tag_json):
        logger.info('_verify_and_route: enc_id=%d output files missing, route to file_copy', enc_id)
        db.update_encoding(enc_id, state='file_copy')
        return STATE_NUM['file_copy']

    # --- delete ---
    if current == STATE_NUM['delete']:
        return STATE_NUM['delete']
    if current < STATE_NUM['encode_end']:
        db.update_encoding(enc_id, state='delete')
        return STATE_NUM['delete']

    return STATE_NUM['encode_end']
