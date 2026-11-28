"""副音声版の動画を作る（一時ファイル・同時に作らない）"""

import asyncio
import os
from quart import current_app
from api.routes.media import purge_secondary_audio_cache


# 副音声版 MP4 の生成を video ごとに直列化する（レンジ要求で二重生成しないため）
_secondary_audio_locks: dict[int, asyncio.Lock] = {}


def _secondary_audio_dir(cfg) -> str:
    return os.path.join((cfg.get('tmp_base') or '/tmp'), 'secondary_audio')


async def _build_secondary_audio_file(video: dict) -> str:
    """副音声だけを持つ MP4 を生成して、そのパスを返す（生成済みなら再利用）。

    ブラウザ側で音声トラックを切り替えられない環境（Safari 以外は audioTracks 非対応）向けに、
    ローカルダウンロードで副音声を選べるようにするためのもの。
    - 別 ES の副音声がある … 2本目の音声だけを残して無変換リマックス
    - 音声が1本（デュアルモノ）… 右チャンネル（＝副音声）をステレオ化して音声のみ再エンコード
    失敗時は RuntimeError を投げる。
    """
    src = video['file_path']
    cfg = current_app.config['ENCODE_AUTO']
    st = os.stat(src)
    out_dir = _secondary_audio_dir(cfg)
    os.makedirs(out_dir, exist_ok=True)
    # 元ファイルが差し替わったら作り直されるよう mtime/size をキーに含める
    out = os.path.join(out_dir, f'{video["id"]}_{int(st.st_mtime)}_{st.st_size}.mp4')
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out

    from media.probe.ffprobe import count_audio_streams
    audio_count = count_audio_streams(cfg.get('ffprobe', 'ffprobe'), src, service_id=video.get('sid'))
    if isinstance(audio_count, int) and audio_count >= 2:
        map_args = ['-map', '0:v:0', '-map', '0:a:1', '-c', 'copy']
    else:
        map_args = ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
                    '-af', 'pan=stereo|c0=c1|c1=c1', '-c:a', 'aac', '-b:a', '192k']

    part = out + '.part'
    proc = await asyncio.create_subprocess_exec(
        cfg.get('ffmpeg', 'ffmpeg'), '-y', '-v', 'error', '-i', src,
        # 出力は .part（生成途中を配信しないための一時名）なので拡張子から muxer を推測できない
        *map_args, '-movflags', '+faststart', '-f', 'mp4', part,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not os.path.exists(part) or os.path.getsize(part) == 0:
        try: os.remove(part)
        except OSError: pass
        raise RuntimeError((stderr or b'').decode('utf-8', 'replace')[-500:] or 'ffmpeg failed')
    os.replace(part, out)
    # 期限切れの古い生成物をついでに掃除する（1本で数百MB〜数GBになるため）
    purge_secondary_audio_cache(cfg.get('tmp_base') or '')
    return out
