"""録画を区間で分ける入口（split_recording）。区間の時刻の文字列を秒に直す補助も持つ。"""
import logging
from .corrected.split import split_ts_corrected
from .keyframes import split_by_keyframes
from .segment import Segment

logger = logging.getLogger(__name__)


def time_str_to_sec(t: str) -> float:
    """'HH:MM:SS.mmm' → 秒数(float)"""
    h, m, s = t.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def split_recording(input_path: str, segments: list[dict], output_dir: str,
                    key_frames: list[dict] | None = None,
                    display_shift: int | None = None) -> list[str]:
    """
    Args:
        input_path: 元TSファイルパス
        segments: [{'start_offset': 'HH:MM:SS.mmm', 'end_offset': 'HH:MM:SS.mmm',
                    'output_filename': 'seg_1.ts'}, ...]
        output_dir: 出力先ディレクトリ（tmp_dir）
        key_frames: [{'offset': int, 'dts': int}, ...]。指定時は TS を全走査せず
            byte 範囲コピーで分割する（split_by_keyframes）。失敗時は従来法へフォールバック。

    Returns:
        出力ファイルパスのリスト（segments と同順）

    Raises:
        RuntimeError: 分割失敗時
    """
    segs = [
        Segment(
            start_time=time_str_to_sec(s['start_offset']),
            end_time=time_str_to_sec(s['end_offset']),
            output_filename=s['output_filename'],
        )
        for s in segments
    ]

    # key_frames があれば再スキャンなしの byte 範囲コピーで分割
    if key_frames:
        success, message, output_paths = split_by_keyframes(
            input_path, segs, key_frames, output_dir=output_dir, verbose=False,
            display_shift=display_shift)
        if success:
            return output_paths
        logger.warning('split_recording: split_by_keyframes 失敗(%s)、全走査法にフォールバック', message)

    success, message, output_paths = split_ts_corrected(input_path, segs, output_dir=output_dir,
                                                        verbose=False)
    if not success:
        raise RuntimeError(f'TS分割失敗: {message}')
    return output_paths
