"""動画のサムネイルを1枚取る"""

import subprocess
from .frame_grab import _keyframe_pre_seek


def get_thumbnail(ffmpeg_path: str, ts_path: str, timestamp_sec: float = 5.0, width: int = 240,
                  key_frames=None) -> bytes | None:
    """ffmpeg で指定秒のフレームを JPEG として返す。取得失敗時は None。

    pre-seek (-ss 前) でキーフレームまで高速移動し、残りを accurate seek (-ss 後) で
    フレーム精度シークする。key_frames があれば timestamp_sec 直前のキーフレームへ pre-seek し、
    ソフトデコード距離を 1 GOP 未満に抑える（無ければ従来どおり t-5 秒へ pre-seek）。
    """
    pre_seek = _keyframe_pre_seek(key_frames, timestamp_sec)
    if pre_seek is None:
        pre_seek = max(0.0, timestamp_sec - 5.0)
    offset   = max(0.0, timestamp_sec - pre_seek)
    try:
        result = subprocess.run(
            [
                ffmpeg_path,
                '-ss', str(pre_seek),
                '-i', ts_path,
                '-ss', str(offset),
                '-vframes', '1',
                '-vf', f'scale=iw*sar:ih,scale={width}:-2',
                '-f', 'image2',
                '-vcodec', 'mjpeg',
                'pipe:1',
            ],
            capture_output=True, timeout=30,
        )
        return result.stdout if result.returncode == 0 and result.stdout else None
    except Exception:
        return None
