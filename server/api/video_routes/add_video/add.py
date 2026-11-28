"""音楽の取り込み・アップロード・手動追加"""

import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _save_tag  # noqa: F401
from ..library.manual_defaults import _MANUAL_TAG_STR_FIELDS, _manual_output_format, _upload_roots  # noqa: F401
from ..confirmed.tag_columns import _fill_video_codec  # noqa: F401
from .media import (  # noqa: F401
    _generate_video_thumbnails,
)
from .manual_place import _station_ids_for, _place_manual_video


@bp.get('/videos/upload_roots')
def video_upload_roots():
    """アップロード先に選べるディレクトリ(encode_dir_list)を返す。"""
    roots = _upload_roots(current_app.config['ENCODE_AUTO'])
    return jsonify([{'path': r, 'exists': os.path.isdir(r)} for r in roots])


@bp.post('/videos/upload')
async def upload_video_file():
    """動画ファイルをアップロードして保存する（ライブラリの「動画追加」のアップロード方式）。

    クエリ: ?name=<ファイル名>[&dir=<保存先ディレクトリ>]
    ボディはファイルの生バイト列（multipart ではない）。数GBになるためメモリに載せず
    ストリームで書き出す。

    dir を省略すると一時置き場に受ける。置き場所(フォルダ名・ファイル名)は
    app_output_path_format / tag.json の app_output_path から決まるので、登録時に
    「移動」と同じ処理でそこへ動かす。つまりアップロードは「いったんサーバーへ置く」
    だけで、それ以降はサーバー上のパスを指定した場合と同じ経路を通る。
    dir を渡した場合だけそのディレクトリに直接置く（encode_dir_list 配下に限定）。
    """
    config = current_app.config['ENCODE_AUTO']
    dest_dir = (request.args.get('dir') or '').strip()
    name = os.path.basename((request.args.get('name') or '').strip())
    if not name:
        abort(400, description='name は必須です')
    if not dest_dir:
        # 置き場所は登録時に app_output_path_format から決めて移動する。
        # アップロードは「いったんサーバーへ置く」だけなので一時置き場で受ける
        # （こうするとサーバー上のパスを指定した場合と登録以降の処理が完全に同じになる）
        real_dir = os.path.join(config.get('tmp_base') or '/tmp', 'uploads')
    else:
        roots = _upload_roots(config)
        real_dir = os.path.realpath(dest_dir)
        if not roots or not any(real_dir == r or real_dir.startswith(r + os.sep) for r in roots):
            abort(400, description='保存先は encode_dir_list 配下のディレクトリを指定してください')
    os.makedirs(real_dir, exist_ok=True)
    dest = os.path.join(real_dir, name)
    if os.path.exists(dest):
        abort(409, description=f'同名のファイルが既にあります: {dest}')

    tmp = dest + '.uploading'
    written = 0
    try:
        with open(tmp, 'wb') as f:
            async for chunk in request.body:
                f.write(chunk)
                written += len(chunk)
        os.replace(tmp, dest)
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        abort(500, description=f'アップロードに失敗しました: {e}')
    import logging
    logging.getLogger(__name__).info('upload_video_file: %s (%d bytes)', dest, written)
    return jsonify({'file_path': dest, 'size': written}), 201


@bp.post('/videos/add_manual')
async def add_video_manual():
    """フォーム入力から tag.json を生成して video.db へ登録する（ライブラリの「動画追加」）。

    body: {file_path(必須・サーバー上の実在ファイル), folder, title, episode_number,
           episode_name, eit_title, eit_station_name, eit_start_time, furigana, category}
    file_size / duration_sec はサーバー側で補完し、tag.json を file_path+'.tag.json' に保存する。
    既に tag.json がある場合は 409（「tagビデオ追加」を使う）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    file_path = (body.get('file_path') or '').strip()
    if not file_path:
        abort(400, description='file_path は必須です')
    if not os.path.isfile(file_path):
        abort(400, description=f'ファイルが見つかりません: {file_path}')
    tag_path = file_path + '.tag.json'
    if os.path.exists(tag_path):
        abort(409, description='tag.json が既に存在します（「tagビデオ追加」を使ってください）')

    tag = {'version': '2.0', 'app_output_path': file_path}
    for key in _MANUAL_TAG_STR_FIELDS:
        v = body.get(key)
        if v is not None and str(v).strip() != '':
            tag[key] = str(v).strip()
    # 放送識別(ロゴ表示・重複判定に使う)は数値で入れる
    for key in ('onid', 'tsid', 'sid', 'eid'):
        v = body.get(key)
        if v is not None and str(v).strip() != '':
            try:
                tag[key] = int(str(v).strip())
            except ValueError:
                abort(400, description=f'{key} は数値で指定してください')
    # 放送局名があるのに sid が無い場合は自動で割り当てる。sid は局名とセットで扱う値で
    # 利用者が入力するものではない（フォームにも入力欄を置かない）
    if tag.get('eit_station_name') and not tag.get('sid'):
        tag.update(_station_ids_for(db, tag['eit_station_name']))
    cats = body.get('category')
    if isinstance(cats, str):
        cats = [c.strip() for c in cats.split(',') if c.strip()]
    if not cats:
        # 既定カテゴリはライブラリの慣例に合わせ folder(アルバム名) を使う
        cats = [tag.get('folder')] if tag.get('folder') else []
    tag['category'] = cats
    try:
        tag['file_size'] = os.path.getsize(file_path)
    except OSError:
        pass
    try:
        from media.probe.ffprobe import get_duration
        config = current_app.config['ENCODE_AUTO']
        dur = get_duration(config.get('ffprobe', 'ffprobe'), file_path)
        if dur:
            tag['duration_sec'] = dur
    except Exception:
        pass
    # 置き場所: keep=そのまま登録 / move=ライブラリへ移動 / copy=コピーして原本を残す。
    # 移動・コピー先は tagビデオ追加と同じ規則（<encode_dir>/<folder>/<元のファイル名>）で
    # 決める。app_output_path_format も入れておくと、後からフォルダ変更や再配置が効く。
    place = (body.get('place') or 'keep').strip()
    encode_dir = (body.get('encode_dir') or '').strip()
    moved_to = None
    if place in ('move', 'copy'):
        if not encode_dir:
            abort(400, description='移動/コピーには保存先(encode_dir)が必要です')
        res = _place_manual_video(tag, file_path, encode_dir, copy=(place == 'copy'))
        if res.get('error'):
            abort(400, description=res['error'])
        file_path, tag_path, moved_to = res['path'], res['path'] + '.tag.json', res['path']
    elif encode_dir:
        tag['encode_dir'] = encode_dir
    if not tag.get('app_output_path_format'):
        # パス形式は config.yml の output_path（エンコード時と同じ既定）から入れる。
        # 手入力させる値ではないし、無いと後からのフォルダ変更・再配置が効かない
        tag['app_output_path_format'] = _manual_output_format(
            current_app.config['ENCODE_AUTO'], tag)

    warning = _fill_video_codec(tag, file_path)
    _save_tag(tag_path, tag)
    video_id = db.add_videos(tag)
    # サムネイル（代表＋シークバー用タイル）は自動生成する。手入力させる情報ではないので、
    # 失敗しても登録は成功させる（後から差し替えもできる）
    thumbs = _generate_video_thumbnails(db, video_id, file_path, tag)
    return jsonify({'id': video_id, 'tag_path': tag_path, 'moved_to': moved_to,
                    'thumbnails': thumbs, 'warning': warning}), 201


