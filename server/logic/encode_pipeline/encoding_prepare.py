"""エンコードの前準備（トリムの avs・使い回せるキュー・古い出力の片付け）"""

import glob as _glob
import json
import os
import shutil
from logic.storage.path_translator import container_to_host
from .common import logger
from .base.states import _DONE_STATES, _FAILED_STATES
from .amatsukaze.poll import _drop_failed_amz_item
from .trim.avs import _parse_trim_mode_segments
from .trim.cmcheck import _prepare_trim_avs


def _ensure_trim_avs(db, enc, encode_info, client, amz_vols, stop_event):
    """trimモード: 本エンコード投入前に {SrcPath}.trim.avs 書き込みを完了させる。

    MPEG-2 は frame_index で自前生成し CMCheck 省略、未対応時のみ CMCheck へフォールバック。
    以降の Batch 投入は無変更（Amatsukaze が trim.avs を --trimavs で自動適用する）。
    """
    enc_id = enc['id']
    # 印(trim_avs_done)だけでなく trim.avs の現物を見る。印が立っていても実体が
    # 無ければ Amatsukaze は trim を一切かけずに元TS全体を出力してしまい、それが
    # 判るのは4時間後のエンコード完了時になる。
    if encode_info.get('trim_mode') and encode_info.get('trim_avs_done'):
        _avs = container_to_host(encode_info.get('input_ts', ''), amz_vols)
        if _avs and not os.path.exists(_avs + '.trim.avs'):
            logger.warning('run_encoding: enc_id=%d trim.avs が見当たらないので書き直します: %s',
                           enc_id, _avs + '.trim.avs')
            encode_info['trim_avs_done'] = False

    if encode_info.get('trim_mode') and not encode_info.get('trim_avs_done'):
        trim_spec = _parse_trim_mode_segments(enc.get('segments'))
        if trim_spec is None:
            logger.warning('run_encoding: enc_id=%d trim_mode だが segments に trim が無い、通常経路で続行', enc_id)
        elif getattr(client, 'is_demo', False):
            logger.warning('run_encoding: enc_id=%d demoモードのため trim.avs をスキップ', enc_id)
        else:
            _prepare_trim_avs(db, enc, encode_info, client, amz_vols,
                              trim_spec, stop_event=stop_event)


def _find_reusable_item(db, enc_id, encode_info, client, amz_vols):
    """前回入れた Amatsukaze の item がまだ使えればその id。無ければ None。"""
    existing_item_id = encode_info.get('amz_item_id')
    input_ts = encode_info.get('input_ts')
    item_id = None
    try:
        q = client.get_queue()
        items = q.get('items', []) or []
        by_id = {it.get('id'): it for it in items if 'id' in it}
        prev = by_id.get(existing_item_id)
        # 失敗のまま残っている item は再利用しない。再利用すると次のポーリングが
        # その場で失敗を見て、実際にエンコードを試さないまま毎回同じエラーを
        # 返し続ける（実測: 0.2秒で失敗を繰り返して復帰できなかった）。
        # complete は再利用してよい（途中で落ちたときに結果を拾い直せる）。
        prev_failed = prev is not None and \
            str(prev.get('state', '')).lower() in _FAILED_STATES
        if prev is not None and not prev_failed:
            item_id = existing_item_id
            logger.info('run_encoding: reuse existing amz item_id=%d (skip add_queue)', item_id)
        elif prev_failed:
            logger.info('run_encoding: 前回の amz item_id=%s は %s のまま残っているので'
                        '捨てて入れ直します', existing_item_id, prev.get('state'))
            _drop_failed_amz_item(client, prev, amz_vols)
            encode_info['amz_item_id'] = None
            db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
        elif input_ts:
            # Amatsukaze(Dockerコンテナ)が PC 再起動で再起動すると、Queue.xml から
            # 復元する際に SrcPath/AddTime は保つが item の数値 id を振り直す。
            # 保存済み id では一致しなくなるため、srcPath(=input_ts) で同一 item を
            # 再特定して二重登録を防ぐ。終端でない item を優先する。
            cands = [it for it in items if it.get('srcPath') == input_ts and it.get('id') is not None]
            active = [it for it in cands if str(it.get('state', '')).lower() not in _DONE_STATES]
            # ここでも失敗のまま残っている item は拾わない（拾うと毎回その場で
            # 失敗を返す。srcPath はこのエンコード専用の cut.ts なので捨ててよい）
            usable = [it for it in cands
                      if str(it.get('state', '')).lower() not in _FAILED_STATES]
            for dead in cands:
                if dead not in usable:
                    _drop_failed_amz_item(client, dead, amz_vols)
            pick = active or usable
            if pick:
                item_id = pick[-1]['id']
                encode_info['amz_item_id'] = item_id
                db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
                logger.info('run_encoding: re-matched amz item by srcPath, item_id=%d (was %s)',
                            item_id, existing_item_id)
    except Exception as e:
        logger.warning('run_encoding: reuse-check get_queue failed: %s', e)
    return item_id


def _remove_old_outputs(encode_info, amz_vols):
    """キューに入れる前に、出力先(outputs.dstPath)に残っている前回の amt* と同じ名前の出力を消す。"""
    _outputs = encode_info.get('outputs', [])
    if isinstance(_outputs, dict):
        _outputs = [_outputs]
    if not _outputs:
        return
    _dst_amz = _outputs[0].get('dstPath', '').rstrip('/')
    _dst_app = container_to_host(_dst_amz, amz_vols) if _dst_amz else None
    if not (_dst_app and os.path.isdir(_dst_app)):
        return
    for old_amt in _glob.glob(os.path.join(_dst_app, 'amt*')):
        if os.path.isdir(old_amt):
            shutil.rmtree(old_amt)
            logger.info('run_encoding: old amt_dir removed: %s', old_amt)
    _input_ts_amz = encode_info.get('input_ts', '')
    if _input_ts_amz:
        _input_basename = os.path.basename(_input_ts_amz)
        _input_stem = os.path.splitext(_input_basename)[0]
        for _entry in os.listdir(_dst_app):
            if (os.path.splitext(_entry)[0] == _input_stem
                    and _entry != _input_basename
                    and os.path.isfile(os.path.join(_dst_app, _entry))):
                try:
                    os.remove(os.path.join(_dst_app, _entry))
                    logger.info('run_encoding: old stem file removed: %s', _entry)
                except Exception as _e:
                    logger.warning('run_encoding: old stem file remove failed: %s: %s', _entry, _e)
