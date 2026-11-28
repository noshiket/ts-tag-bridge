"""tag.json から動画を登録する（行き先を決めて置く）"""

import asyncio
import os
import shutil
from typing import Optional
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.tag_io import _load_tag, _remap_watch_history_video, _save_tag
from .library.manual_defaults import _upload_roots
from .confirmed.tag_columns import _fill_video_codec


def _dest_from_tag(tag: dict, encode_dir: str) -> Optional[str]:
    """tag と保存先(encode_dir)から、この動画を置くべきパスを決める。

    app_output_path は {$encode_dir} 以外が展開済みなので、そこを差し替えるだけでよい。
    既に実パスで埋まっている(別サーバーで作られた tag)場合は、その tag の encode_dir から
    見た相対パスを取り出して、指定された保存先の下に組み直す。
    """
    from logic.encode_pipeline.common import _apply_encode_dir

    aop = tag.get('app_output_path') or ''
    root = str(encode_dir).rstrip('/')
    if not aop:
        return None
    if '{$encode_dir}' in aop:
        return _apply_encode_dir(aop, root)
    old_root = str(tag.get('encode_dir') or '').rstrip('/')
    if old_root and (aop == old_root or aop.startswith(old_root + os.sep)):
        return os.path.join(root, os.path.relpath(aop, old_root))
    return None


def _place_video_by_tag(tag: dict, tag_path: str, video_path: str, encode_dir: str,
                        copy: bool = False) -> dict:
    """動画を tag が示す場所（<encode_dir>/<folder>/<ファイル名>）へ移す/コピーする。"""
    from logic.storage.mount_point import safe_makedirs

    config = current_app.config['ENCODE_AUTO']
    roots = _upload_roots(config)
    real_root = os.path.realpath(encode_dir)
    if not roots or not any(real_root == r or real_root.startswith(r + os.sep) for r in roots):
        return {'error': '保存先は encode_dir_list 配下のディレクトリを指定してください'}
    dest = _dest_from_tag(tag, encode_dir)
    if not dest:
        return {'error': ('tag.json から置き場所を決められません'
                          '（app_output_path / encode_dir を確認してください）')}
    if os.path.realpath(dest) == os.path.realpath(video_path):
        tag['app_output_path'] = dest
        tag['encode_dir'] = encode_dir
        _save_tag(video_path + '.tag.json', tag)
        return {'moved': False, 'tag_path': video_path + '.tag.json', 'video_path': video_path}
    if os.path.exists(dest):
        return {'error': f'移動先に既にファイルがあります: {dest}'}
    try:
        safe_makedirs(dest)
    except Exception as e:
        return {'error': f'移動先を作れません: {e}'}

    old_stem, new_stem = os.path.splitext(video_path)[0], os.path.splitext(dest)[0]
    xfer = shutil.copy2 if copy else shutil.move
    xfer(video_path, dest)
    for src, dst in ((tag_path, dest + '.tag.json'),
                     (old_stem + '.thumbnail.webp', new_stem + '.thumbnail.webp'),
                     (old_stem + '.thumbnail_tile.webp', new_stem + '.thumbnail_tile.webp')):
        if os.path.exists(src) and os.path.realpath(src) != os.path.realpath(dst):
            xfer(src, dst)
    tag['app_output_path'] = dest
    tag['encode_dir'] = encode_dir
    for key, suf in (('thumbnail_path', '.thumbnail.webp'), ('thumbnail_tile_path', '.thumbnail_tile.webp')):
        if tag.get(key):
            tag[key] = new_stem + suf if os.path.exists(new_stem + suf) else tag[key]
    _save_tag(dest + '.tag.json', tag)
    return {'moved': True, 'tag_path': dest + '.tag.json', 'video_path': dest}


@bp.post('/videos/add_from_tag')
async def add_video_from_tag():
    """既存の tag.json、または動画に埋め込んだメタデータから video.db へ登録する
    （ライブラリの「tagビデオ追加」）。

    body: {tag_path(必須), replace(任意・同一file_pathの既存行を差し替え)}
    tag_path には tag.json か動画(.mp4等)のどちらを渡してもよい:
      - 動画を指定 → 隣の <動画>.tag.json を使う
      - 隣に tag.json が無ければ、動画に埋め込んだメタデータ(ダウンロード時に付与)から
        復元し、同梱のサムネ/シークサムネタイルも書き出す
    """
    from logic.meta import media_meta
    from logic.meta import mp4_meta
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    given = (body.get('tag_path') or '').strip()
    if not given:
        abort(400, description='tag_path は必須です')
    if not os.path.isfile(given):
        abort(400, description=f'ファイルが見つかりません: {given}')

    # 動画を渡された場合は隣の tag.json を探す（拡張子で判定せず、実在で判断する）
    if given.endswith('.tag.json'):
        tag_path, video_path = given, given[:-len('.tag.json')]
    else:
        tag_path, video_path = given + '.tag.json', given

    source, written = 'tag.json', {}
    tag = _load_tag(tag_path) if os.path.isfile(tag_path) else None
    if tag is None:
        if not os.path.isfile(video_path):
            abort(400, description=f'tag.json が見つかりません: {tag_path}')
        cfg = current_app.config['ENCODE_AUTO']
        meta = await asyncio.to_thread(mp4_meta.read_mp4_meta, video_path,
                                       cfg.get('ffprobe', 'ffprobe'))
        if not meta or meta.get('kind') != 'video' or not meta.get('tag'):
            abort(400, description=(f'tag.json が見つからず、動画にも埋め込みメタデータが'
                                    f'ありませんでした: {os.path.basename(video_path)}'))
        tag = dict(meta['tag'])
        source = '埋め込みメタデータ'
        # 同梱されているサムネ/シークサムネタイルを動画の隣へ書き出す
        # （タイルは動画を全走査しないと作れないので作り直さずに済ませる）
        written = await asyncio.to_thread(media_meta.extract_images, meta,
                                          os.path.splitext(video_path)[0])
        if written.get('thumbnail'):
            tag['thumbnail_path'] = written['thumbnail']
        if written.get('thumbnail_tile'):
            tag['thumbnail_tile_path'] = written['thumbnail_tile']
        if meta.get('thumbnail_info') and not tag.get('thumbnail_info'):
            tag['thumbnail_info'] = meta['thumbnail_info']
        # 置き場所が変わっていることがあるので実体のパスに合わせる
        tag['app_output_path'] = video_path
        # 次回以降は普通に読めるよう tag.json も書き出しておく
        try:
            _save_tag(tag_path, tag)
        except Exception as e:
            current_app.logger.warning('add_from_tag: tag.json の書き出しに失敗(無視): %s', e)

    aop = tag.get('app_output_path')
    if not aop:
        abort(400, description='tag.json に app_output_path がありません')

    # encode_dir 指定時は、置き場所を tag から決めて動画を移す。
    # 保存先(どの encode_dir か)以外は tag に全部入っている:
    #   app_output_path      … {$encode_dir} 以外は展開済み（フォルダ名もファイル名も拡張子も）
    #   app_output_path_format … その元テンプレート
    # なので、利用者にサブフォルダを打たせる必要はない。
    if body.get('encode_dir') and (body.get('place') or 'move') != 'keep':
        placed = _place_video_by_tag(tag, tag_path, video_path, body['encode_dir'],
                                     copy=(body.get('place') == 'copy'))
        if placed.get('error'):
            abort(400, description=placed['error'])
        if placed.get('moved'):
            tag_path, video_path, aop = placed['tag_path'], placed['video_path'], placed['video_path']

    if not os.path.isfile(aop):
        abort(400, description=f'app_output_path のファイルが見つかりません: {aop}')
    if os.path.abspath(tag_path) != os.path.abspath(aop + '.tag.json'):
        abort(400, description='tag.json は 動画ファイル+".tag.json" の位置に置いてください')
    warning = _fill_video_codec(tag, aop)
    video_id = db.add_videos(tag, replace=bool(body.get('replace')),
                             on_replace=_remap_watch_history_video)
    return jsonify({'id': video_id, 'source': source,
                    'thumbnails': sorted(written.keys()),
                    'captures': len(db.get_captures(video_id)),
                    'warning': warning}), 201
