"""ffprobe / ffmpeg ユーティリティ"""

import json
import os
import logging
import subprocess

# ffprobe の既定パス。ffprobe_path を引数で受け取れない呼び出し元（VideoDB など）が使う。
# main.py が起動時に config の ffprobe で configure() する。
FFPROBE_PATH = 'ffprobe'


logger = logging.getLogger(__name__)


def configure(ffprobe_path: str | None) -> None:
    """既定の ffprobe パスを設定する（起動時に1回）。"""
    global FFPROBE_PATH
    if ffprobe_path:
        FFPROBE_PATH = ffprobe_path


def get_duration(ffprobe_path: str, ts_path: str) -> float | None:
    """ffprobe で動画の実尺（秒）を取得する。取得失敗時は None を返す。"""
    try:
        result = subprocess.run(
            [ffprobe_path, '-v', 'quiet', '-print_format', 'json', '-show_format', ts_path],
            capture_output=True, text=True, timeout=60,
        )
        data = json.loads(result.stdout)
        return float(data['format']['duration'])
    except Exception:
        return None


def count_audio_streams(ffprobe_path: str, ts_path: str, service_id: int | None = None) -> int | None:
    """対象サービス内の音声ストリーム数を数える。取得失敗時は None。

    通常の probe は先頭しか解析せず、後から現れる副音声（解説放送・二カ国語の第2音声など）を
    取りこぼすため、analyzeduration / probesize を大きくして解析する。
    service_id 指定時はその program（= MPEG-TS の program_number = サービスID）内の音声のみ数え、
    BS/CS の他サービスの音声を除外する。一致する program が無ければ音声が最も多い program を採用する。
    """
    try:
        # MPEG-4 は program(=サービス)を持たないため show_programs では数えられない。
        # moov に全ストリームが載っているので音声ストリームを直接数える(深い解析は不要)。
        if ts_path.lower().endswith(('.mp4', '.m4v')):
            result = subprocess.run(
                [ffprobe_path, '-v', 'error', '-select_streams', 'a',
                 '-print_format', 'json', '-show_streams', ts_path],
                capture_output=True, text=True, timeout=60,
            )
            return len(json.loads(result.stdout).get('streams', []))

        result = subprocess.run(
            [ffprobe_path, '-v', 'error',
             '-analyzeduration', '20000000', '-probesize', '100000000',
             '-print_format', 'json', '-show_programs', ts_path],
            capture_output=True, text=True, timeout=120,
        )
        programs = json.loads(result.stdout).get('programs', [])
        if not programs:
            return None

        def _n_audio(p):
            return sum(1 for s in p.get('streams', []) if s.get('codec_type') == 'audio')

        target = None
        if service_id is not None:
            target = next((p for p in programs if p.get('program_id') == service_id), None)
        if target is None:
            target = max(programs, key=_n_audio)  # サービス未指定/不一致なら主サービス想定で音声最多
        return _n_audio(target)
    except Exception:
        return None


def detect_secondary_audio(file_path: str, eit_audio_info: str = '',
                           ffprobe_path: str | None = None) -> int | None:
    """副音声（二カ国語の第2音声・解説放送・デュアルモノの副）の有無。1=あり / 0=なし / None=判定不能。

    判定は実データのみで行う。番組名の [二]/[解説]/[副音声] 等の表記は編成の慣習で付いたり
    付かなかったりするうえ、エンコード時に音声が落ちていても題名には残るため根拠にしない。
    - 別 ES の副音声（二カ国語・解説放送）… 実ファイルの音声ストリーム本数で判定する
    - デュアルモノ（1ES 内に主/副）… エンコード後は 2ch ステレオと区別が付かないため、
      放送側のメタデータである EIT の音声モード（audio component descriptor）で判定する
    ファイルが無い等で数えられなければ None（＝未判定のまま残し、後で測り直す）。
    """
    if any(m in (eit_audio_info or '') for m in ('デュアル', '1/0+1/0', '二重')):
        return 1
    if not file_path or not os.path.exists(file_path):
        return None
    count = count_audio_streams(ffprobe_path or FFPROBE_PATH, file_path)
    if count is None:
        return None
    return 1 if count >= 2 else 0


def get_video_info(ffprobe_path: str, ts_path: str) -> dict | None:
    """ffprobe でビデオ/オーディオストリーム情報を返す。

    Returns:
        {
            "video": {"codec": str, "width": int, "height": int, "fps": float, "bitrate": int|None},
            "audio": [
                {"index": int, "codec": str, "channels": int, "sample_rate": int|None, "bitrate": int|None},
                ...
            ],
        }
        どちらかのストリームがなければそのキーは含まれない。取得失敗時は None。
    """
    try:
        result = subprocess.run(
            [ffprobe_path, '-v', 'quiet', '-print_format', 'json', '-show_streams', ts_path],
            capture_output=True, text=True, timeout=60,
        )
        streams = json.loads(result.stdout).get('streams', [])

        video = next((s for s in streams if s.get('codec_type') == 'video'), None)
        audios = [s for s in streams if s.get('codec_type') == 'audio']

        info = {}
        if video:
            fps = 0.0
            try:
                num, den = video.get('avg_frame_rate', '0/1').split('/')
                fps = round(int(num) / int(den), 3) if int(den) else 0.0
            except Exception:
                pass
            info['video'] = {
                'codec':   video.get('codec_name', ''),
                'width':   video.get('width'),
                'height':  video.get('height'),
                'fps':     fps,
                'field_order': video.get('field_order'),
                'sar':     video.get('sample_aspect_ratio'),   # 画素の縦横比（"4:3" など。放送の 1440×1080 は 4:3 で表示は 16:9）
                'bitrate': int(video['bit_rate']) if video.get('bit_rate') else None,
            }
        if audios:
            info['audio'] = [
                {
                    'index':       a.get('index'),
                    'codec':       a.get('codec_name', ''),
                    'channels':    a.get('channels'),
                    'sample_rate': int(a['sample_rate']) if a.get('sample_rate') else None,
                    'bitrate':     int(a['bit_rate']) if a.get('bit_rate') else None,
                }
                for a in audios
            ]
        return info or None
    except Exception:
        return None


