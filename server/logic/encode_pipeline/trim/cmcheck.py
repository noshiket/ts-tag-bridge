"""CM の区間と、CM 判定を回して trim.avs を書く"""

import json
import os
import shutil
from logic.storage.path_translator import container_to_host
from ..common import (  # noqa: F401
    logger,
)
from ..segments import _data_dir
from ..head_refs import _read_head_refs  # noqa: F401
from ..base.states import _DONE_STATES  # noqa: F401
from ..amatsukaze.amt_dir import _get_check_amt_dir  # noqa: F401
from ..amatsukaze.repair import _repair_too_small_ts  # noqa: F401
from ..amatsukaze.queue import amatsukaze_add_queue  # noqa: F401
from ..amatsukaze.poll import amatsukaze_poll_complete  # noqa: F401
from .avs import (  # noqa: F401
    _write_trim_avs_file,
)


def _cm_jls_segments(db, enc: dict) -> list:
    """録画の CM解析結果から jls_segments（チャプター区間とラベル）を取り出す。"""
    try:
        rec = db.get_recording(enc.get('recording_id'))
        raw = (rec or {}).get('cm_analysis')
        if not raw:
            return []
        from logic import cmcut
        ts_path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
        result = cmcut.align_to_first_pts(json.loads(raw), rec.get('id'), ts_path)
        return result.get('jls_segments') or []
    except Exception as e:
        logger.warning('_cm_jls_segments: 取得失敗 rec_id=%s: %s', enc.get('recording_id'), e)
        return []


def _prepare_trim_avs(db, enc: dict, encode_info: dict, client,
                      amz_vols: list, trim_spec, stop_event=None) -> None:
    """trim指定エンコードの前段: {SrcPath}.trim.avs を用意する。

    MPEG-2 は frame_index でTSヘッダ解析だけで amts0.dat 互換のフレーム表を生成し、
    CMCheck(約15分)を省略する（実amts0.dat 12本と framePTS 完全一致を検証済み）。
    frame_index 未対応（H.264/H.265 等）の場合のみ従来の CMCheck 経路へフォールバックする。
    完了後 encode_info['trim_avs_done']=True。失敗は RuntimeError（encode_error 経路。
    trim 指定を無視した成果物は作らない）。
    """
    enc_id = enc['id']
    input_ts = encode_info.get('input_ts', '')
    input_ts_app = container_to_host(input_ts, amz_vols)
    if not input_ts_app or not os.path.exists(input_ts_app):
        raise RuntimeError(f'trimモード: input_ts が見つかりません: {input_ts}')

    # 高速経路: TSヘッダ解析のフレーム表(録画ごとにキャッシュ)で CMCheck を省略する。
    # UIのフレーム番号表示と同じキャッシュ・同じ time_to_frame を使うため両者が厳密一致する。
    pts_list = None
    first_pts = None
    try:
        from media.frame_index.cache import get_or_build_frame_table
        from media.frame_index.table_file import frame_index_path
        first_pts, _ = _read_head_refs(input_ts_app)
        cache_path = frame_index_path(enc['recording_id'], _data_dir())
        pts_list, first_pts = get_or_build_frame_table(input_ts_app, cache_path, first_pts)
    except RuntimeError as e:
        logger.info('run_encoding: enc_id=%d frame_index 非対応(%s) → CMCheck 経路へ', enc_id, e)
        pts_list = None

    if pts_list:
        avs_line = _write_trim_avs_file(input_ts_app, first_pts, trim_spec, pts_list)
        logger.info('run_encoding: enc_id=%d trim.avs 書き込み(frame_index/CMCheck省略, %dフレーム): %s',
                    enc_id, len(pts_list), avs_line)
        encode_info['trim_avs_done'] = True
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        return

    # フォールバック: 従来の CMCheck 経路
    _run_cmcheck_and_write_trim(db, enc, encode_info, client, amz_vols, trim_spec, stop_event)


def _run_cmcheck_and_write_trim(db, enc: dict, encode_info: dict, client,
                                amz_vols: list, trim_spec, stop_event=None) -> None:
    """trim指定エンコードの前段(フォールバック): CMCheck 投入→完了待ち→trim.avs 書き込み→後片付け。

    完了後 encode_info['trim_avs_done']=True を保存する。CMCheck 失敗時は
    RuntimeError（encode_error 経路）。物理分割へはフォールバックしない
    （trim 指定を無視した成果物を作らないため）。
    """
    from media.amatsukaze.amatsukaze_files.frames import parse_amtsource_dat

    enc_id = enc['id']
    input_ts = encode_info.get('input_ts', '')
    input_ts_app = container_to_host(input_ts, amz_vols)
    if not input_ts_app or not os.path.exists(input_ts_app):
        raise RuntimeError(f'trimモード: input_ts が見つかりません: {input_ts}')

    # CMCheck item の再利用（run_encoding の amz_item_id 再利用と同型。id 振り直しに備え
    # srcPath 再マッチは mode=CMCheck のアイテムに限定する）
    cm_item_id = encode_info.get('amz_cm_item_id')
    if cm_item_id is not None:
        try:
            q = client.get_queue()
            items = q.get('items', []) or []
            if cm_item_id not in {it.get('id') for it in items if 'id' in it}:
                cands = [it for it in items
                         if it.get('srcPath') == input_ts and it.get('id') is not None
                         and str(it.get('mode', '')).lower() == 'cmcheck']
                active = [it for it in cands
                          if str(it.get('state', '')).lower() not in _DONE_STATES]
                pick = active or cands
                cm_item_id = pick[-1]['id'] if pick else None
        except Exception as e:
            logger.warning('_run_cmcheck_and_write_trim: reuse-check get_queue failed: %s', e)

    if cm_item_id is None:
        logger.info('run_encoding: enc_id=%d CM解析(CMCheck) を投入', enc_id)
        cm_item_id = amatsukaze_add_queue(client, {**encode_info, 'mode': 'CMCheck'})
        if cm_item_id is None:
            raise RuntimeError(f'CM解析(CMCheck) のキュー追加に失敗: enc_id={enc_id}')
    encode_info['amz_cm_item_id'] = cm_item_id
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))

    def _poll_cm():
        return amatsukaze_poll_complete(
            client, cm_item_id, stop_event=stop_event,
            should_abort=lambda: db.get_encoding(enc_id) is None,
            amz_volumes=amz_vols,
        )

    try:
        try:
            cm_item = _poll_cm()
        except RuntimeError as e:
            if not _repair_too_small_ts(db, enc, encode_info, client, cm_item_id, e, amz_vols):
                raise
            cm_item_id = amatsukaze_add_queue(client, {**encode_info, 'mode': 'CMCheck'})
            if cm_item_id is None:
                raise RuntimeError(f'CM解析(CMCheck) のキュー追加に失敗: enc_id={enc_id}')
            encode_info['amz_cm_item_id'] = cm_item_id
            db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
            cm_item = _poll_cm()
    except InterruptedError:
        raise
    except RuntimeError as e:
        raise RuntimeError(f'CM解析(CMCheck)失敗: {e}') from e

    amt_dir_app = _get_check_amt_dir(client, cm_item, input_ts, amz_vols)
    if not amt_dir_app:
        raise RuntimeError(f'CM解析(CMCheck) の amt 一時フォルダが特定できません: item_id={cm_item_id}')

    dat_file = os.path.join(amt_dir_app, 'amts0.dat')
    if not os.path.exists(dat_file):
        raise RuntimeError(f'CM解析(CMCheck) 結果に amts0.dat がありません: {amt_dir_app}')
    pts_list = parse_amtsource_dat(dat_file)
    if not pts_list:
        raise RuntimeError(f'amts0.dat のフレーム PTS が空です: {dat_file}')
    first_pts, _ = _read_head_refs(input_ts_app)

    avs_line = _write_trim_avs_file(input_ts_app, first_pts, trim_spec, pts_list)
    logger.info('run_encoding: enc_id=%d trim.avs 書き込み(CMCheck): %s', enc_id, avs_line)

    # CMCheck の後片付け（best-effort）
    try:
        client.change_queue(cm_item_id, 'RemoveItem')
        logger.info('run_encoding: enc_id=%d CMCheck item_id=%d removed', enc_id, cm_item_id)
    except Exception as e:
        logger.warning('run_encoding: CMCheck RemoveItem failed: %s', e)
    try:
        if os.path.isdir(amt_dir_app):
            shutil.rmtree(amt_dir_app)
    except Exception as e:
        logger.warning('run_encoding: CMCheck amt_dir 削除失敗: %s', e)

    encode_info['amz_cm_item_id'] = None
    encode_info['trim_avs_done'] = True
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
