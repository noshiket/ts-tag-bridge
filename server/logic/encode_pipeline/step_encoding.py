"""Step 3: encoding"""

import json
import os
import sys
from datetime import datetime
from .common import (  # noqa: F401
    logger,
)
from .amatsukaze.queue import amatsukaze_add_queue  # noqa: F401
from .encoded_output import _find_encoded_file  # noqa: F401
from .encoding_prepare import _ensure_trim_avs, _find_reusable_item, _remove_old_outputs  # noqa: F401
from .encoding_poll import _poll_encoding, _collect_amt_dir  # noqa: F401


# ===========================================================================
# Step 3: run_encoding
# ===========================================================================

def run_encoding_addon(db, enc: dict, addon_name: str, ctx: dict, recording: dict,
                       config: dict, stop_event=None) -> None:
    """アドオンエンコーダー(encode_type='addon:<name>')で encoding ステップを実行する。

    アドオンは input_ts(分割済みcut.ts) を output_dir へエンコードし
    {'output_path', 'trim_segments', 'chapter_txt'} を返す。結果は encode_info へ
    保存し、以降(TOTトリム/ffprobe/サムネ/tag.json/配置/DB登録)は既存ステップが扱う。
    """
    from logic.addons import addon_runner

    enc_id = enc['id']
    db.update_encoding(enc_id, state='encoding', progress=0.0)
    encode_info = json.loads(enc.get('encode_info') or '{}')

    input_ts = encode_info.get('input_ts') or ''
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    output_dir = (outputs[0].get('dstPath', '') if outputs else '') or ''
    if not input_ts or not os.path.exists(input_ts):
        raise FileNotFoundError(f'入力TSが見つかりません: {input_ts}')
    os.makedirs(output_dir, exist_ok=True)

    log_lines = []

    def _log(msg):
        line = f'[{datetime.now().strftime("%H:%M:%S")}] {msg}'
        log_lines.append(line)
        # UIのコンソール表示用に随時保存する(末尾500行に制限)
        encode_info['addon_log'] = log_lines[-500:]
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info, ensure_ascii=False))
        logger.info('run_encoding_addon: enc_id=%d %s', enc_id, msg)

    def _step(name, ratio=None):
        encode_info['addon_step'] = str(name)
        fields = {'encode_info': json.dumps(encode_info, ensure_ascii=False)}
        if ratio is not None:
            try:
                fields['progress'] = min(1.0, max(0.0, float(ratio)))
            except (TypeError, ValueError):
                pass
        db.update_encoding(enc_id, **fields)

    def _should_abort():
        if stop_event is not None and stop_event.is_set():
            return True
        return db.get_encoding(enc_id) is None  # 行削除(キュー削除/再登録)で中断

    mod, schema, spdir = addon_runner.load_addon(addon_name, target='encoder')
    a_ctx = addon_runner.EncoderAddonContext(
        enc=enc, recording=recording, input_ts=input_ts, output_dir=output_dir,
        output_stem=os.path.splitext(os.path.basename(input_ts))[0],
        source_ts=ctx.get('source_ts_app', ''), config=config,
        rule_db=db, video_db=None,
        log_fn=_log, step_fn=_step, abort_fn=_should_abort)

    params = dict((encode_info.get('params') or {}))
    # スキーマのdefaultで欠損を補う(パラメータ未保存の録画でも動くように)
    for p in schema.get('params') or []:
        params.setdefault(p['key'], p.get('default'))

    _log(f'アドオン {schema["label"]} ({addon_name}) を実行します')
    if spdir and spdir not in sys.path:
        sys.path.insert(0, spdir)
    try:
        result = mod.run(a_ctx, params)
    finally:
        if spdir:
            try:
                sys.path.remove(spdir)
            except ValueError:
                pass

    # 戻り値の検証(不正なら例外→run_one_encodingがencode_errorに回収)
    if not isinstance(result, dict):
        raise ValueError(f'アドオンの戻り値が dict ではありません: {type(result).__name__}')
    out_path = result.get('output_path')
    if not out_path or not os.path.exists(out_path):
        raise ValueError(f'output_path が存在しません: {out_path!r}')
    trim_segs = result.get('trim_segments')
    if not isinstance(trim_segs, list) or not trim_segs:
        raise ValueError('trim_segments は1区間以上のリストが必須です'
                         '(カットしない場合は ctx.full_trim_segments() を使用)')
    for seg in trim_segs:
        if not isinstance(seg, dict) or not seg.get('start') or not seg.get('end'):
            raise ValueError(f'trim_segments の要素が不正です: {seg!r}')

    encode_info['addon_output_path'] = out_path
    encode_info['addon_trim_segments'] = trim_segs
    if result.get('chapter_txt'):
        encode_info['addon_chapter_txt'] = result['chapter_txt']
    encode_info['addon_log'] = log_lines[-500:]
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info, ensure_ascii=False), progress=1.0)
    logger.info('run_encoding_addon: enc_id=%d 完了 output=%s trim=%d区間',
                enc_id, out_path, len(trim_segs))


def run_encoding(db, enc: dict, client, amz_vols: list, stop_event=None) -> None:
    """
    Amatsukaze にキュー追加 → ポーリング → amt_dir 取得 → amt_dir 移動。
    """
    enc_id = enc['id']
    db.update_encoding(enc_id, state='encoding')

    encode_info = json.loads(enc.get('encode_info') or '{}')
    _ensure_trim_avs(db, enc, encode_info, client, amz_vols, stop_event)

    # 既存の Amatsukaze item がまだキューに残っていれば再利用する（新規追加しない）。
    # LogoPending でエラー化 → ロゴ登録で当該 item が自動エンコード開始 → 復旧 retry の際、
    # 二重登録を避けて既存 item をポーリングし直すため。
    item_id = None
    if encode_info.get('amz_item_id') is not None:
        item_id = _find_reusable_item(db, enc_id, encode_info, client, amz_vols)

    if item_id is None:
        # 新規追加: キュー追加前に outputs.dstPath の古いファイルを削除
        _remove_old_outputs(encode_info, amz_vols)
        # キュー追加
        item_id = amatsukaze_add_queue(client, encode_info)
        encode_info['amz_item_id'] = item_id
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info))

    if item_id is None:
        raise RuntimeError(f'amatsukaze_add_queue: item_id not found for enc_id={enc_id}')

    queue_item = _poll_encoding(db, enc, encode_info, client, item_id, amz_vols, stop_event)
    _collect_amt_dir(db, enc_id, encode_info, client, queue_item, amz_vols)

    # Amatsukaze が complete を返してもエンコード成果物(cut.mp4)が無いことがある
    # （本編区間が0フレーム＝CM全カット/ロゴ未検出など）。この場合 file_copy まで
    # 進めず、エンコード段階で失敗として検出する。
    if not _find_encoded_file(encode_info, amz_vols):
        raise RuntimeError(
            'エンコード成果物が生成されませんでした'
            '（本編区間0フレームの可能性: CM全カット / ロゴ未検出）'
        )

    logger.debug('run_encoding: enc_id=%d complete', enc_id)
