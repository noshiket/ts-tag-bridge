"""音楽の取り込みのファイル作り（再生用 MP4・ジャケット・保存用 FLAC・タグの書き込み）"""

import os
import shutil
import subprocess
from logic.frame_sync.xcorr import nice_kwargs


import logging

# 元の logic.music.music_import と同じ名前でログに出す
logger = logging.getLogger('logic.music.music_import')

# 再生用 MP4 の絵。プレイヤーの 16:9 に黒帯を出さないため、ジャケットを中央に置き
# 背景は同じジャケットを引き伸ばしてぼかす。1fps・全フレームキーフレームなので
# サイズはほぼ音声分だけで済み、シークは1秒単位で効く。
WIDTH, HEIGHT = 1280, 720


_COVER_HEIGHT = 648          # 中央のジャケットの高さ(上下に少し余白を残す)


_BLUR = f'[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,' \
        f'crop={WIDTH}:{HEIGHT},boxblur=40:2,eq=brightness=-0.18[bg];' \
        f'[0:v]scale=-1:{_COVER_HEIGHT}:force_original_aspect_ratio=decrease[fg];' \
        f'[bg][fg]overlay=(W-w)/2:(H-h)/2[v]'


AUDIO_BITRATE = '320k'


# キーフレーム間隔（1fps なので秒数と同じ）。絵は最初から最後まで同じなので、
# キーフレーム以外はほぼ 0 バイトになる。全フレームをキーフレームにすると静止画を
# 毎秒作り直すことになり、実測で 4分の曲が 映像27MB + 音声9MB = 36MB まで膨らんだ
# （-g 30 で 13MB、-g 300 で 11MB）。シークは絵が同じなのでどこへ飛んでも見た目は変わらない。
GOP = 30


NICE = 10


def _run(cmd, nice=NICE, timeout=600):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                          **nice_kwargs(nice))


# 埋め込みジャケットの形式 → 保存する拡張子。原本のまま(再エンコードせず)出す。
_COVER_EXT = {'mjpeg': '.jpg', 'jpeg': '.jpg', 'png': '.png', 'bmp': '.bmp'}


def cover_path(out_mp4: str, codec: str = '') -> str:
    """ジャケット原本の置き場所。再生用MP4の隣に、元の形式のまま置く。"""
    return os.path.splitext(out_mp4)[0] + '.cover' + _COVER_EXT.get(codec, '.png')


def extract_cover(ffmpeg: str, src: str, out: str, nice=NICE) -> str | None:
    """埋め込みジャケットを抜き出す。無ければ None。

    元の画像をそのまま取り出す（-c:v copy）。再エンコードすると原本の画質が落ちるうえ、
    再生用MP4の中の絵は 1280x720 に合成したものなので、原寸のジャケットはここにしか残らない。
    形式が copy で書けないものは png へ変換して落とさないようにする。
    """
    r = _run([ffmpeg, '-nostdin', '-y', '-v', 'error', '-i', src,
              '-an', '-c:v', 'copy', '-frames:v', '1', out], nice=nice, timeout=120)
    if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
        alt = os.path.splitext(out)[0] + '.png'
        r = _run([ffmpeg, '-nostdin', '-y', '-v', 'error', '-i', src,
                  '-an', '-frames:v', '1', alt], nice=nice, timeout=120)
        out = alt
    if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    return None


def build_play_mp4(ffmpeg: str, src: str, out_mp4: str, cover: str | None,
                   thumb_path: str | None = None, nice=NICE, duration: float = 0) -> str:
    """原本 + ジャケットから再生用 MP4 を作る。サムネ(webp)も同じ絵から1枚書く。

    duration(原本の尺)を渡すと -t で切る。-shortest だけだと静止画側が余分に伸びる
    （filter_complex を通すと音声が終わった後もパイプラインに残ったぶんが書き出される。
    実測: 167.19秒の曲で映像が 210 秒＝43秒ぶん長い）。ブラウザは映像側の尺を
    その動画の長さとして出すので、曲が終わった後に無音の絵が残ってしまう。
    """
    if cover:
        head = ['-loop', '1', '-framerate', '1', '-i', cover]
        vf = ['-filter_complex', _BLUR, '-map', '[v]']
    else:
        # ジャケットが無い時は無地。ぼかす元が無いのでフィルタ段ごと省く
        head = ['-f', 'lavfi', '-i', f'color=c=0x111111:s={WIDTH}x{HEIGHT}:r=1']
        vf = ['-map', '0:v']
    cmd = [ffmpeg, '-nostdin', '-y', '-v', 'error'] + head + ['-i', src] + vf + [
        '-map', '1:a', '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
        '-r', '1', '-g', str(GOP), '-c:a', 'aac', '-b:a', AUDIO_BITRATE,
        '-shortest', '-movflags', '+faststart']
    if duration and duration > 0:
        cmd += ['-t', f'{duration:.3f}']
    cmd.append(out_mp4)
    r = _run(cmd, nice=nice)
    if r.returncode != 0 or not os.path.exists(out_mp4):
        raise RuntimeError(f'再生用MP4の生成に失敗: {(r.stderr or "").strip()[:200]}')
    if thumb_path:
        # MP4 と同じ絵を1枚だけ切り出す（動画用の ThumbnailGenerator は
        # 顔検出とスコアリングで3分かかるので通さない）
        t = _run([ffmpeg, '-nostdin', '-y', '-v', 'error', '-i', out_mp4,
                  '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', thumb_path],
                 nice=nice, timeout=120)
        if t.returncode != 0:
            logger.warning('music_import: サムネ生成に失敗 %s: %s', src, (t.stderr or '')[:200])
    return out_mp4


# 原本を消しても困らないよう、取り込み時に可逆の控えを作る。
# 再生用MP4 の音声は AAC 320k で非可逆（実測: 原本と decode 結果の MD5 が一致しない。
# FLAC は一致する＝ビット単位で同じ）。原本が無くなるとここからしか戻せない。
LOSSLESS_PCM = ('.aiff', '.aif', '.wav')      # 生PCM → FLAC に可逆圧縮して控える


ARCHIVE_LEVEL = '8'                            # FLAC の圧縮率（実測 42MB → 32MB）


def archive_path(out_mp4: str, src: str) -> str:
    """可逆の控えの置き場所。再生用MP4 の隣に .src を付けて置く。"""
    stem = os.path.splitext(out_mp4)[0]
    ext = os.path.splitext(src)[1].lower()
    return stem + '.src' + ('.flac' if ext in LOSSLESS_PCM else ext)


def build_archive(ffmpeg: str, src: str, out: str, nice=NICE) -> str:
    """原本の控えを作る。

    生PCM(AIFF/WAV)は FLAC へ可逆圧縮する（中身は同じで小さくなる）。
    それ以外（FLAC/ALAC/MP3 等）は既に圧縮済みなので、そのまま複製する
    （非可逆の音源を FLAC に入れ直しても音は良くならず、大きくなるだけ）。
    タグとジャケットも一緒に持たせる。
    """
    if os.path.splitext(src)[1].lower() not in LOSSLESS_PCM:
        shutil.copy2(src, out)
        return out
    r = _run([ffmpeg, '-nostdin', '-y', '-v', 'error', '-i', src,
              '-map', '0', '-c:a', 'flac', '-compression_level', ARCHIVE_LEVEL,
              '-c:v', 'copy', out], nice=nice)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(f'可逆の控えを作れませんでした: {(r.stderr or "").strip()[:200]}')
    return out


def write_tags(ffmpeg: str, path: str, tags: dict, nice=NICE) -> bool:
    """音声ファイルの埋め込みタグを書き換える（中身は再エンコードしない）。

    原本を消す前提なので、控え(.src.*)と再生用MP4のタグが古いままだと、
    そのファイル単体を他所へ持ち出した時に曲情報が失われる。
    """
    if not path or not os.path.exists(path):
        return False
    tmp = path + '.retag' + os.path.splitext(path)[1]
    cmd = [ffmpeg, '-nostdin', '-y', '-v', 'error', '-i', path, '-map', '0', '-c', 'copy']
    for k, v in tags.items():
        cmd += ['-metadata', f'{k}={v}']
    if path.lower().endswith(('.aiff', '.aif', '.mp3')):
        cmd += ['-write_id3v2', '1']
    cmd.append(tmp)
    r = _run(cmd, nice=nice, timeout=300)
    if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
        logger.warning('music_import: タグを書けませんでした %s: %s', path, (r.stderr or '')[:200])
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False
    os.replace(tmp, path)
    return True
