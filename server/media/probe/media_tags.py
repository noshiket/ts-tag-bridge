"""音声・動画のタグを読む（ffprobe）"""

import json
import subprocess


def get_media_tags(ffprobe_path: str, path: str) -> dict:
    """音楽ファイルの埋め込みタグを取り出す（AIFF/MP3 の ID3、FLAC の Vorbis comment、
    M4A の iTunes atom）。

    タグのキーはコンテナごとに大文字小文字も名前も揺れる（TITLE / title / Title、
    album_artist / ALBUMARTIST、track / TRACKNUMBER）ので、小文字に畳んでから拾う。
    format と各 stream の両方に入り得るため両方を見る（FLAC は stream 側に入ることがある）。
    取れなかったキーは入れない（呼び出し側がファイル名等へ落とす）。

    'cover' は埋め込み画像(attached_pic)を持つかどうか。
    """
    try:
        result = subprocess.run(
            [ffprobe_path, '-v', 'quiet', '-print_format', 'json',
             '-show_format', '-show_streams', path],
            capture_output=True, text=True, timeout=60,
        )
        data = json.loads(result.stdout)
    except Exception:
        return {}

    streams = data.get('streams') or []
    raw = {}
    for tags in [(data.get('format') or {}).get('tags') or {}] + \
                [(s.get('tags') or {}) for s in streams]:
        for k, v in tags.items():
            key = str(k).lower()
            if key not in raw and str(v).strip():
                raw[key] = str(v).strip()

    def pick(*names):
        for n in names:
            if raw.get(n):
                return raw[n]
        return None

    out = {}
    for key, names in (
        ('title',  ('title', 'inam')),
        ('artist', ('artist', 'iart', 'author')),
        ('album',  ('album', 'iprd')),
        ('album_artist', ('album_artist', 'albumartist')),
        ('genre',  ('genre', 'ignr')),
        ('date',   ('date', 'year', 'icrd')),
    ):
        v = pick(*names)
        if v:
            out[key] = v
    # トラック番号は "3/12" の形が普通なので分子だけ取る
    track = pick('track', 'tracknumber')
    if track:
        num = track.split('/')[0].strip()
        if num.isdigit():
            out['track'] = int(num)
    try:
        out['duration'] = float((data.get('format') or {}).get('duration'))
    except (TypeError, ValueError):
        pass
    art = next((s for s in streams if s.get('codec_type') == 'video'
                and (s.get('disposition') or {}).get('attached_pic')), None)
    out['cover'] = art is not None
    if art:
        # 抜き出す時に元の画像のまま(再エンコードせず)保存できるよう、形式を控える
        out['cover_codec'] = art.get('codec_name') or ''
        out['cover_size'] = [art.get('width'), art.get('height')]
    aud = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    if aud:
        # 変換後は AAC になるので、元が何だったか(可逆/量子化ビット/サンプリング)を残す
        out['audio'] = {
            'codec': aud.get('codec_name') or '',
            'sample_rate': int(aud['sample_rate']) if aud.get('sample_rate') else None,
            'channels': aud.get('channels'),
            'bits_per_sample': (aud.get('bits_per_raw_sample')
                                or aud.get('bits_per_sample') or None),
            'bit_rate': int(aud['bit_rate']) if aud.get('bit_rate') else None,
        }
    # 拾えた埋め込みタグを全部そのまま残す（composer / disc / comment / ISRC 等、
    # こちらが使わないものも tag.json に控えておけば後から参照できる）
    out['all'] = raw
    return out
