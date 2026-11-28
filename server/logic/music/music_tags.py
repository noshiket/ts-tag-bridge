"""音楽のタグから tag.json を作る（アルバム・曲番号・キー）"""

import os
import re


# 置き場所のテンプレート。エンコード後の動画(config.yml の output_path)と同じ仕組みで、
# folder=アーティスト / title=アルバム / episode_number=トラック番号 に展開される。
# 保存先(encode_dir)を選んだ時だけ効く（選ばなければ原本の隣に置く）。
OUTPUT_FORMAT = '{$encode_dir}/{$folder}/{$title}/{$episode_number} {$episode_name}{$ext}'
OUTPUT_FORMAT_NO_TRACK = '{$encode_dir}/{$folder}/{$title}/{$episode_name}{$ext}'


# 曲情報として編集する埋め込みタグ（AIFF/MP3 は ID3、FLAC は Vorbis comment）。
# キーは ffprobe が返す名前（小文字）に合わせる。値は tag.json の media_tags に持つ。
TAG_FIELDS = (
    ('title',        '曲名'),
    ('artist',       'アーティスト'),
    ('album_artist', 'アルバムアーティスト'),
    ('album',        'アルバム'),
    ('track',        'トラック番号'),
    ('disc',         'ディスク番号'),
    ('date',         '年'),
    ('genre',        'ジャンル'),
    ('composer',     '作曲'),
    ('lyricist',     '作詞'),
    ('performer',    '演奏'),
    ('publisher',    'レーベル'),
    ('copyright',    '著作権'),
    ('comment',      'コメント'),
    ('lyrics',       '歌詞'),
)


def derive_from_tags(tags: dict) -> dict:
    """埋め込みタグから、ライブラリ側の値（アーティスト=album 等）を導く。

    取り込み時(build_tag)と同じ対応。曲情報を直した時にライブラリの分類も追従させる。
    """
    artist = _clean(tags.get('album_artist') or tags.get('artist')) or '不明なアーティスト'
    out = {
        'artist': artist,
        'folder': artist,
        'eit_station_name': artist,
        'eit_genre': f'音楽 > {tags["genre"]}' if tags.get('genre') else '音楽',
    }
    if tags.get('album'):
        out['title'] = _clean(tags['album'])
    if tags.get('title'):
        out['episode_name'] = out['eit_title'] = tags['title']
    track = str(tags.get('track') or '').split('/')[0].strip()
    if track.isdigit():
        out['episode_number'] = f'{int(track):02d}'
    if tags.get('date'):
        out['eit_start_time'] = str(tags['date'])
    if tags.get('comment'):
        out['eit_description'] = str(tags['comment'])
    return out


def _clean(name: str) -> str:
    """フォルダ名/ファイル名に使えない文字を落とす（既存の text_parser と同じ方針）。"""
    return re.sub(r'[\\/:*?"<>|]', '_', (name or '').strip()) or ''


def music_key(tags: dict, artist: str, album: str, track: str, title: str) -> str:
    """同じ曲かどうかを照合するキー。置き場所やファイル名に依らない。

    CD から取り込んだものは TOC(itunes_cddb_1 = 総時間+各トラックの開始位置)が
    その盤を一意に指し、トラック番号と合わせれば「その盤のその曲」になる。
    iTunes/Music が書くので、同じCDを別フォルダへリッピングし直しても一致する。
    無い場合（配信で買った曲など）は アーティスト/アルバム/トラック/曲名 で代用する。
    """
    raw = {str(k).lower(): v for k, v in (tags.get('all') or {}).items()}
    disc = str(raw.get('itunes_cddb_1') or '').strip()
    if disc:
        n = str(raw.get('itunes_cddb_tracknumber') or track or '').strip()
        return f'cddb:{disc}:{n}'
    parts = [str(x or '').strip().lower() for x in (artist, album, track, title)]
    return 'meta:' + '/'.join(parts) if any(parts) else ''


def build_tag(src: str, out_mp4: str, tags: dict) -> dict:
    """tag.json の中身を作る。

    album=アーティスト / series=アルバム / episode_number=トラック番号 / 曲名=話数名。
    タグが無いものはファイル名とフォルダ名から埋める（何も無くても登録はできる）。
    """
    stem = os.path.splitext(os.path.basename(src))[0]
    artist = _clean(tags.get('album_artist') or tags.get('artist')) or '不明なアーティスト'
    album = _clean(tags.get('album')) or _clean(os.path.basename(os.path.dirname(src))) or artist
    title = tags.get('title') or stem
    tag = {
        'version': '2.0',
        'media_kind': 'audio',
        'app_output_path': out_mp4,
        'source_path': src,
        'artist': artist,
        'folder': artist,          # album（ライブラリ一覧＝アーティスト）
        'title': album,            # series（アルバム）
        'episode_name': title,
        'eit_title': title,
        'eit_station_name': artist,
        'category': ['音楽'],
        # ジャンル絞り込みは videos.eit_genre を見るので、放送と同じ「大分類 > 小分類」の
        # 形で入れる。「音楽」は EDCB のジャンル大分類にあるものをそのまま使う
        'eit_genre': f'音楽 > {tags["genre"]}' if tags.get('genre') else '音楽',
    }
    if tags.get('track') is not None:
        # ファイル名に使うので2桁に揃える（10曲目が2曲目より前に並ばないように）
        tag['episode_number'] = f'{int(tags["track"]):02d}'
    # 置き場所はテンプレートで決める（エンコード後の動画と同じ扱い）。
    # 保存先(encode_dir)を選ばずに取り込んだ場合も、後から再配置できるよう持たせておく
    tag['app_output_path_format'] = (OUTPUT_FORMAT if tag.get('episode_number')
                                     else OUTPUT_FORMAT_NO_TRACK)
    if tags.get('date'):
        tag['eit_start_time'] = str(tags['date'])
    if tags.get('duration'):
        tag['duration_sec'] = float(tags['duration'])
    # 変換後は AAC 320k になるので、原本が何だったか(可逆/量子化ビット/サンプリング)を残す。
    # eit_audio_info はプレイヤーが「音声情報」として出すので、そこにも読める形で入れる
    if tags.get('audio'):
        tag['source_audio'] = tags['audio']
        a = tags['audio']
        tag['eit_audio_info'] = ' '.join(str(x) for x in [
            (a.get('codec') or '').upper(),
            f"{a['sample_rate'] / 1000:g}kHz" if a.get('sample_rate') else '',
            f"{a['bits_per_sample']}bit" if a.get('bits_per_sample') else '',
            {1: 'モノラル', 2: 'ステレオ'}.get(a.get('channels'), f"{a.get('channels')}ch"
                                              if a.get('channels') else ''),
        ] if x).strip()
    # 拾えた埋め込みタグは全部残す（作曲者・ディスク番号・コメント・ISRC 等、
    # こちらが使っていないものも後から参照できるように）
    if tags.get('all'):
        tag['media_tags'] = tags['all']
    # 二重取り込みの判定用。置き場所が違っても同じ曲だと分かるようにする
    key = music_key(tags, artist, album, tag.get('episode_number') or '', title)
    if key:
        tag['music_key'] = key
    try:
        tag['file_size'] = os.path.getsize(out_mp4)
    except OSError:
        pass
    return tag
