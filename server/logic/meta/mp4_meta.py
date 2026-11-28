"""MP4 に情報を埋め込む・読む"""

import json
import os
import subprocess
import tempfile
from .common import META_KEY, logger


def embed_mp4_meta(src: str, dst: str, meta: dict, ffmpeg: str = 'ffmpeg',
                   timeout: int = 3600) -> str:
    """src を再多重化して dst にメタデータ付きで書き出す（映像/音声は無変換）。

    ライブラリの実ファイルは書き換えない方針なので、呼び出し側は一時ファイルを渡すこと。
    """
    text = json.dumps(meta, ensure_ascii=False)
    tmp = dst + '.part'
    # サムネタイルを同梱すると数MBになり -metadata では引数長の上限に掛かるため、
    # ffmetadata ファイル経由で渡す（実測 1.8MB でも通る）。
    fd, metafile = tempfile.mkstemp(suffix='.ffmeta', dir=os.path.dirname(dst) or None)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(';FFMETADATA1\n' + META_KEY + '=' + _ffmeta_escape(text) + '\n')
        # 拡張子が .part だと ffmpeg が出力形式を判別できないので -f mp4 を明示する
        cmd = [ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', src, '-i', metafile,
               '-map', '0', '-map_metadata', '1', '-c', 'copy',
               '-movflags', 'use_metadata_tags+faststart', '-f', 'mp4', tmp]
        try:
            subprocess.run(cmd, check=True, timeout=timeout,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except subprocess.CalledProcessError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise RuntimeError((e.stderr or b'').decode('utf-8', 'replace')[-300:] or 'ffmpeg failed')
    finally:
        try:
            os.remove(metafile)
        except OSError:
            pass
    os.replace(tmp, dst)
    return dst


def _ffmeta_escape(v: str) -> str:
    for ch in ('\\', '=', ';', '#', '\n'):
        v = v.replace(ch, '\\' + ch)
    return v


def read_mp4_meta(path: str, ffprobe: str = 'ffprobe', timeout: int = 60):
    """MP4 から埋め込みメタデータを読む。無ければ None。"""
    cmd = [ffprobe, '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', path]
    try:
        out = subprocess.run(cmd, check=True, timeout=timeout,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        tags = (json.loads(out or b'{}').get('format') or {}).get('tags') or {}
    except Exception as e:
        logger.debug('MP4メタデータの読み出しに失敗 %s: %s', path, e)
        return None
    # ffprobe はタグ名の大小を保つが、コンテナによって揺れるので緩く探す
    raw = next((v for k, v in tags.items() if k.lower() == META_KEY), None)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
