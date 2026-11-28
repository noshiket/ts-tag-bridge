"""入力の TS を話の区間で切り出す"""

import data_paths
import json
import os
from typing import Optional
from logic.storage.path_translator import container_to_host
from .common import logger


def _split_input_ts(
    source_ts_app: str,
    enc: dict,
    encode_info: dict,
    amz_vols: list,
) -> Optional[str]:
    """
    recordings.app_ts_path を encodings.segments の区間で分割し、
    分割後の amz パスを返す。segments が NULL/空の場合は None を返す。
    """
    from logic.ts_split.recording import split_recording, time_str_to_sec

    segments_raw = enc.get('segments')
    if not segments_raw:
        return None

    seg_str = json.loads(segments_raw)
    base_part = seg_str.split(',')[0]
    if base_part == 'full':
        return None  # 単話・全体マーカー: 分割せず全体を使う
    start_sec = max(0.0, time_str_to_sec(base_part[:12]))
    end_sec   = time_str_to_sec(base_part[13:])

    if end_sec <= start_sec:
        logger.warning(
            '_split_input_ts: enc_id=%d segment end(%.3f) <= start(%.3f), clamp to EOF',
            enc['id'], end_sec, start_sec,
        )
        end_sec = start_sec + 86400

    def _fmt_sec(sec: float) -> str:
        h  = int(sec) // 3600
        m  = (int(sec) % 3600) // 60
        s  = int(sec) % 60
        ms = round((sec % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"

    start_off = _fmt_sec(start_sec)
    end_off   = _fmt_sec(end_sec)

    input_ts_amz = encode_info.get('input_ts', '')
    tmp_dir_amz = os.path.dirname(input_ts_amz)
    tmp_dir_app = container_to_host(tmp_dir_amz, amz_vols)
    os.makedirs(tmp_dir_app, exist_ok=True)

    output_filename = os.path.basename(input_ts_amz)

    # key_frames があれば再スキャンなしの byte 範囲コピーで分割（無ければ従来の全走査法）
    kf_raw = enc.get('key_frames')
    key_frames = None
    if kf_raw:
        try:
            key_frames = json.loads(kf_raw) if isinstance(kf_raw, str) else kf_raw
        except Exception:
            key_frames = None

    # 表示/trim(first_pts基準)と物理分割(key_frames[0]基準)の原点差を補正する。
    # key_framesのdtsは独自の連続化基準のため、フレーム表があれば
    # frames[0](最初のGOP頭の表示PTS) - first_pts を原点差として渡す。
    # 補正なしだと切断が表示より約0.5秒後ろへずれ、頭が欠けることがある
    display_shift = None
    try:
        from media.frame_index.cache import get_frame_table_cached
        from media.frame_index.table_file import frame_index_path
        _data_dir = data_paths.DATA_DIR
        _cache = frame_index_path(enc['recording_id'], _data_dir)
        if os.path.exists(_cache):
            _frames, _fp = get_frame_table_cached(source_ts_app, _cache)
            display_shift = _frames[0] - _fp
    except Exception:
        display_shift = None

    split_recording(
        source_ts_app,
        [{'start_offset': start_off, 'end_offset': end_off, 'output_filename': output_filename}],
        tmp_dir_app,
        key_frames=key_frames,
        display_shift=display_shift,
    )

    split_ts_amz = tmp_dir_amz.rstrip('/') + '/' + output_filename
    logger.info('_split_input_ts: enc_id=%d split → %s (key_frames=%s)',
                enc['id'], split_ts_amz, 'yes' if key_frames else 'no')
    return split_ts_amz
