"""media_meta — 動画/画像そのものに DB 再構築用のメタデータを埋め込む・読み出す。

目的は「ファイル単体を別サーバーへ持って行っても DB を作り直せる」こと。
動画は tag.json の内容、キャプチャ画像は EIT/TOT と紐づけ情報を入れる。

  動画(MP4) : ffmpeg -c copy で udta へ `encode_auto` タグとして JSON を書く。
              ライブラリの実ファイルは書き換えず、ダウンロード時に一時ファイルを作る。
  画像(PNG) : iTXt チャンクを IEND の直前に挿入する。
  画像(JPEG): COM(0xFFFE) マーカーを SOI の直後に挿入する。

いずれも Pillow 等の追加依存なしで扱える形式にしてある（画像は純粋なバイト操作、
動画は既に必須の ffmpeg/ffprobe を使う）。
"""

import base64
import os

from .common import logger

# メタデータの形式が変わった時に読み手が分岐できるようにする
META_VERSION = 1

# tag.json のうち動画へ埋める項目。巨大でファイルを膨らませるもの
# (comments_json/captions_json/thumbnail_tile 等)は入れない。
_VIDEO_META_DROP = {
    'comments_json', 'captions_json', 'captions2_json', 'captions3_json',
    'thumbnail_tile_path', 'thumbnail_info', 'chapter_txt',
}


# サムネ/タイルを一緒に入れる上限。タイルは実測で 0.8〜2.3MB あるので、
# 極端に大きいものだけ諦める（動画本体に比べれば誤差だが、無制限にはしない）。
_MAX_EMBED_IMAGE = 8 * 1024 * 1024


def build_video_meta(tag: dict, with_images: bool = True) -> dict:
    """tag.json → 動画へ埋め込む dict。巨大な派生データは落とす。

    with_images=True のとき、サムネイルとシークサムネタイル(webp)も base64 で同梱する。
    タイルは動画を走査し直さないと作れないため、持ち込み先で作り直さずに済むようにする。
    """
    body = {k: v for k, v in (tag or {}).items() if k not in _VIDEO_META_DROP}
    meta = {'v': META_VERSION, 'kind': 'video', 'tag': body}
    if not with_images:
        return meta
    for key, tag_key in (('thumbnail', 'thumbnail_path'), ('thumbnail_tile', 'thumbnail_tile_path')):
        path = (tag or {}).get(tag_key)
        blob = _read_image_file(path)
        if blob:
            meta[key] = base64.b64encode(blob).decode('ascii')
            meta[key + '_name'] = os.path.basename(path)
    # タイルの割り付け情報(列数/間隔)が無いとシークサムネを復元できない
    if (tag or {}).get('thumbnail_info'):
        meta['thumbnail_info'] = tag['thumbnail_info']
    return meta


def _read_image_file(path):
    if not path or not isinstance(path, str) or not os.path.isfile(path):
        return None
    try:
        if os.path.getsize(path) > _MAX_EMBED_IMAGE:
            logger.info('サムネが大きすぎるため同梱しません(%s)', path)
            return None
        with open(path, 'rb') as f:
            return f.read()
    except OSError as e:
        logger.warning('サムネの読み込みに失敗(同梱しません): %s', e)
        return None


def extract_images(meta: dict, dest_stem: str) -> dict:
    """埋め込みメタデータからサムネ/タイルを dest_stem の隣へ書き出す。

    dest_stem は拡張子を除いた動画のパス。戻り値は書き出したパスの dict。
    """
    out = {}
    for key, suffix in (('thumbnail', '.thumbnail.webp'), ('thumbnail_tile', '.thumbnail_tile.webp')):
        b64 = (meta or {}).get(key)
        if not b64:
            continue
        # 拡張子は元の名前を優先（webp 以外で作られていた場合に合わせる）
        name = (meta.get(key + '_name') or '')
        ext = os.path.splitext(name)[1] or suffix[suffix.index('.', 1):]
        path = dest_stem + (suffix if not name else suffix.replace('.webp', ext))
        try:
            with open(path, 'wb') as f:
                f.write(base64.b64decode(b64))
            out[key] = path
        except Exception as e:
            logger.warning('サムネの書き出しに失敗 %s: %s', path, e)
    return out


def build_capture_meta(row: dict) -> dict:
    """captures の行 → 画像へ埋め込む dict。

    再取り込み時に「どの番組のどの瞬間か」が分かればよいので、
    EIT と TOT、番組を特定する onid/tsid/sid/eid を入れる。
    video_id/recording_id はサーバー間で意味が変わるため入れない
    （取り込み側は onid/tsid/sid/eid と TOT で既存の動画を探す）。
    """
    keys = ('tot', 'onid', 'tsid', 'sid', 'eid', 'eit_title', 'eit_description',
            'eit_extended_info', 'eit_start_time', 'eit_end_time', 'eit_station_name',
            'created_at')
    return {'v': META_VERSION, 'kind': 'capture',
            'capture': {k: (row or {}).get(k) for k in keys}}


# ---------------------------------------------------------------------------
# 画像 (PNG / JPEG)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 動画 (MP4)
# ---------------------------------------------------------------------------
