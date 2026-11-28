"""Step 4: encoded_analyze"""

import json
import os
from logic.storage.path_translator import container_to_host
from media.probe.ffprobe import get_duration
from .common import (  # noqa: F401
    _apply_encode_dir,
    logger,
)
from .amatsukaze.trim_segments import get_trim_segments  # noqa: F401
from .encoded_output import _find_encoded_file
from .placeholders import _get_ei_tag_path  # noqa: F401
from .tot_trim import _fix_trim_times
from .analyze_inputs import _discover_amt_dir, _load_chapter_txt, _trim_to_segments  # noqa: F401
from .analyze_outputs import _probe_encoded, _check_output_duration, _generate_thumbnails, _update_primary_tag  # noqa: F401


# ===========================================================================
# Step 4: run_encoded_analyze
# ===========================================================================

def run_encoded_analyze(db, enc: dict, source_ts_app: str, amz_vols: list,
                        config: dict = None) -> None:
    """
    trim_segments 取得 → TOT トリム → メディア情報取得 → tag.json 更新 → DB 更新。
    """
    enc_id = enc['id']
    db.update_encoding(enc_id, state='encoded_analyze')

    encode_info = json.loads(enc.get('encode_info') or '{}')
    amt_dir_app = encode_info.get('amt_dir')
    # アドオンエンコーダー: 成果物の発見とCM区間取得(=Amatsukaze依存部分)はアドオンの
    # 戻り値で代替する。以降のTOTトリム/ffprobe/サムネ/tag.json更新は共通処理
    is_addon = bool(encode_info.get('addon_output_path'))

    # amt_dir が未設定の場合、outputs.dstPath 内の amt* ディレクトリを探す
    if not amt_dir_app and not is_addon:
        amt_dir_app = _discover_amt_dir(db, enc_id, encode_info, amz_vols)

    # Amatsukaze に投入した TS の app パス（split 後の場合 source_ts と異なる）
    input_ts_amz = encode_info.get('input_ts', '')
    input_ts_app = container_to_host(input_ts_amz, amz_vols) if input_ts_amz else None

    chapter_txt_content = _load_chapter_txt(db, enc, encode_info, amz_vols, is_addon, input_ts_amz)

    # trim_segments 取得: アドオンは戻り値のものを使う(必須。CMカットしない場合も全体1区間)
    trim_segs = []
    if is_addon:
        trim_segs = encode_info.get('addon_trim_segments') or []
    elif amt_dir_app and source_ts_app:
        try:
            trim_segs = get_trim_segments(
                source_ts_app, amt_dir_app,
                input_ts_app=input_ts_app,
            )
        except Exception as e:
            logger.warning('run_encoded_analyze: get_trim_segments failed: %s', e)

    # TOT トリム
    rec_start_time = enc.get('recording_start_time')
    trim_segs = _fix_trim_times(trim_segs, rec_start_time, enc.get('recording_end_time'))
    # 出力の実尺。欠落の按分に使うので字幕トリムより先に取る（下のメディア情報でも使い回す）
    encoded_path = _find_encoded_file(encode_info, amz_vols)
    ffprobe_path = (config or {}).get('ffprobe', 'ffprobe')
    encoded_duration = get_duration(ffprobe_path, encoded_path) if encoded_path else None
    trimmed = _trim_to_segments(enc, trim_segs, encoded_duration)

    # エンコード済みファイルのメディア情報取得
    video_info_dict, audio_info_list, encoded_file_size, frame_table = (
        _probe_encoded(enc_id, encoded_path, ffprobe_path, encoded_duration))

    err = _check_output_duration(enc, trim_segs, encoded_duration, encoded_path)
    if err:
        logger.error('run_encoded_analyze: enc_id=%d %s', enc_id, err)
        db.update_encoding(enc_id, state='error', error_message=err)
        return

    # final_thumbnail_* = app_output_path ベースの最終パス（tag.json / DB に常に保存）
    # encode_info.thumbnail_* = コピー元パス（file_copy で参照）
    app_out = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir'))
    final_thumbnail_path = None
    final_thumbnail_tile_path = None
    if app_out:
        app_stem = os.path.splitext(app_out)[0]
        final_thumbnail_path = app_stem + '.thumbnail.webp'
        final_thumbnail_tile_path = app_stem + '.thumbnail_tile.webp'

    # サムネイル生成（成功時のみ encode_info にコピー元パスを保存）
    thumbnail_info_dict = None
    if encoded_path and encoded_duration:
        thumbnail_info_dict = _generate_thumbnails(db, enc, encode_info, encoded_path, encoded_duration,
                                                   trim_segs, config, final_thumbnail_path)

    # 一次ファイルの tag.json を更新（encode_info から導出）
    tag_path = _get_ei_tag_path(encode_info, amz_vols)
    if tag_path:
        _update_primary_tag(db, enc, tag_path, trim_segs, trimmed,
                            video_info=video_info_dict, audio_info=audio_info_list,
                            file_size=encoded_file_size, duration_sec=encoded_duration,
                            thumbnail_path=final_thumbnail_path, thumbnail_tile_path=final_thumbnail_tile_path,
                            thumbnail_info=thumbnail_info_dict,
                            chapter_txt=chapter_txt_content, frame_table=frame_table)

    # DB 更新（トリム後は analyzed_* カラムに保存し、元データを残す）
    db.update_encoding(
        enc_id,
        trim_segments=json.dumps(trim_segs),
        analyzed_recording_start_time=trim_segs[0]['start'] if trim_segs else None,
        analyzed_recording_end_time=trim_segs[-1]['end'] if trim_segs else None,
        analyzed_comments_json=trimmed['comments'],
        analyzed_captions_json=trimmed['captions'],
        analyzed_captions2_json=trimmed['captions2'],
        analyzed_drop_error=trimmed['drop_error'],
        analyzed_comment_count=trimmed['comment_count'],
        video_info=json.dumps(video_info_dict) if video_info_dict else None,
        audio_info=json.dumps(audio_info_list) if audio_info_list else None,
        file_size=encoded_file_size,
        duration_sec=encoded_duration,
        thumbnail_path=final_thumbnail_path,
        thumbnail_tile_path=final_thumbnail_tile_path,
        thumbnail_info=json.dumps(thumbnail_info_dict) if thumbnail_info_dict else None,
        chapter_txt=chapter_txt_content,
    )
    logger.debug('run_encoded_analyze: enc_id=%d complete, %d trim_segs', enc_id, len(trim_segs))


