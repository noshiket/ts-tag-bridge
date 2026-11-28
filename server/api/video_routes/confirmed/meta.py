"""確定値・メタ情報の取得と更新、放送からの動画の引き当て"""

from quart import jsonify, current_app, abort
from api.routes.auth import bp, private_cats  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag, _save_tag  # noqa: F401
from .tag_paths import _manual_dest_path, music_default_dir  # noqa: F401
from .tag import _video_confirmed_dict_from_tag, _video_tag_path  # noqa: F401


@bp.get('/videos/<int:video_id>/meta')
def get_video_meta(video_id):
    """視聴履歴表示用の軽量メタ（series名/episode情報のみ）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    filing = db.get_video_filing(video_id)
    if filing is None:
        abort(404)
    # 非公開カテゴリの動画は、プライベートモード以外では存在しない扱いにする
    # （続きを見るの一覧がシリーズ名・話数名を出してしまうため）
    priv = private_cats()
    if priv and video_id in set(db.private_video_ids(priv)):
        abort(404)
    return jsonify({
        'id': video_id,
        'episode_number': filing.get('episode_number'),
        'episode_name': filing.get('episode_name'),
        'series_name': filing.get('title'),
    })


@bp.get('/videos/<int:video_id>/confirmed')
def get_video_confirmed(video_id):
    """動画の確定値（題名・話数・話名・放送日など）を tag.json から作って返す。"""
    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    tag = _load_tag(tag_path) if tag_path else None
    if tag is None:
        abort(404, description='tag.json を読めません（無いか壊れています。サーバーログに理由が出ます）')
    return jsonify(_video_confirmed_dict_from_tag(video_id, tag))


@bp.patch('/videos/<int:video_id>/confirmed')
async def patch_video_confirmed(video_id):
    """確定値を tag.json に保存する（DB は変更しない。relocate の add_videos で取り込む）。"""
    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    tag = _load_tag(tag_path) if tag_path else None
    if tag is None:
        abort(404, description='tag.json を読めません（無いか壊れています。サーバーログに理由が出ます）')
    body = await _json()
    # 複数話 video の episode_idx 変更を受理して tag に保存する(先に更新して、
    # 続く確定値のリスト縮約にも新しい idx を使う)。DB列は無いが、episode_number/
    # episode_name/app_output_path 等の派生値が relocate で DB へ再ファイルされる。
    if 'episode_idx' in body:
        try:
            new_idx = int(body['episode_idx'])
            if new_idx >= 0:
                tag['episode_idx'] = new_idx
        except (TypeError, ValueError):
            pass
    aop_before = tag.get('app_output_path') or ''   # 手で書き換えたかの判定に使う
    # この video は単話なので、複数話で渡ってきたリスト値は episode_idx で単話へ縮約する。
    idx = tag.get('episode_idx')
    if not isinstance(idx, int) or idx < 0:
        idx = 0
    # eit_genre / eit_start_time / eit_description は音楽の「ジャンル・年・コメント」。
    # 放送由来の動画では画面に出していないので、送られてこない限り変わらない
    for key in ('title', 'folder', 'episode_number', 'episode_name', 'category',
                'furigana', 'setting', 'app_output_path_format', 'app_output_path',
                'else_info', 'encode_dir',
                'eit_genre', 'eit_start_time', 'eit_description'):
        if key not in body:
            continue
        val = body[key]
        # category は「カテゴリ名の配列」なので縮約しない。それ以外のリストは idx で単話化。
        if key != 'category' and isinstance(val, list):
            val = val[idx] if idx < len(val) else (val[0] if val else None)
        if key == 'category' and val is not None and not isinstance(val, list):
            val = [val]
        tag[key] = val
    # 音楽の曲情報（埋め込みタグ）。歌詞や作曲者も含めてここで丸ごと受け取り、
    # ライブラリ側の値（アーティスト=album、曲名=話数名 等）はそこから導く。
    # 2箇所に同じものを持たせて食い違わせないため、音楽はこちらが正になる。
    if tag.get('media_kind') == 'audio' and isinstance(body.get('media_tags'), dict):
        from logic.music import music_import as _mi  # noqa: F401
        from logic.music import music_tags
        from logic.music import music_media
        tags = dict(tag.get('media_tags') or {})
        for k, v in body['media_tags'].items():
            v = ('' if v is None else str(v)).strip()
            if v:
                tags[k] = v
            else:
                tags.pop(k, None)      # 空にしたら消す
        tag['media_tags'] = tags
        tag.update(music_tags.derive_from_tags(tags))
        # 控えと再生用ファイルにも同じタグを書く。原本を消す前提なので、
        # ファイル単体を持ち出した時に曲情報が付いてこないと困る
        _ff = current_app.config['ENCODE_AUTO'].get('ffmpeg', 'ffmpeg')
        for f in (tag.get('archive_path') or '', tag.get('app_output_path') or ''):
            try:
                music_media.write_tags(_ff, f, tags)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning('曲情報をファイルへ書けませんでした %s: %s', f, e)
    # 音楽は folder がアーティスト名。表示用の artist 列は別に持っているので、
    # 確定値でアーティストを直したらそちらも合わせる（片方だけ古いと表示が食い違う）
    if tag.get('media_kind') == 'audio' and 'folder' in body:
        tag['artist'] = tag.get('folder') or ''
        tag['eit_station_name'] = tag['artist']
    # 音楽は解析(reparse)を持たないので、置き場所をここで組み直す。動画では再解析が
    # 同じ役割をしていて、{$encode_dir} だけ未解決のまま残した app_output_path を
    # relocate が解決してファイルを動かす。ここでもその形に揃える
    # （解決済みのパスを入れると relocate が no_placeholder で何もしない）。
    # encode_dir を選ばずに取り込んだ(原本の隣に置いた)ものは動かさない。
    # 出力パスを手で書き換えた時（ファイル名を変えたい時）は、その値を尊重して
    # テンプレートから組み直さない
    path_edited = ('app_output_path' in body
                   and (body.get('app_output_path') or '') not in ('', aop_before))
    if (tag.get('media_kind') == 'audio' and tag.get('app_output_path_format')
            and not path_edited
            and any(k in body for k in ('folder', 'title', 'episode_number', 'episode_name',
                                        'encode_dir', 'media_tags'))):
        # 保存先が入っていない曲（原本の隣に取り込んだもの）は既定の保存先へ移す。
        # 入れないと置き場所を組み直せず、名前を直しても一覧に反映されないため
        if not tag.get('encode_dir'):
            tag['encode_dir'] = music_default_dir(current_app.config['ENCODE_AUTO'])
        try:
            # {$encode_dir} をそのまま値として渡すと展開が二度掛かって {{$encode_dir}} に
            # なるため、いったん目印に置き換えてから戻す
            mark = '\x00ENCODE_DIR\x00'
            dest, _t = _manual_dest_path(current_app.config['ENCODE_AUTO'], tag, 'x.mp4', mark)
            if dest and mark in dest:
                tag['app_output_path'] = dest.replace(mark, '{$encode_dir}')
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning(
                'patch_video_confirmed: 音楽の置き場所を組み直せませんでした id=%s: %s', video_id, e)
    _save_tag(tag_path, tag)
    # category はファイルパスに影響しないため、DB(category_nodes=ライブラリのカテゴリ表示)へ
    # 即反映する(他の確定値はパス変更を伴うため relocate の add_videos 取り込みに委ねる)。
    if 'category' in body:
        try:
            db.update_video_categories(video_id, tag.get('category') or [])
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('patch_video_confirmed: category DB反映失敗 id=%s: %s', video_id, e)
    # encode_dir は VideoPushWorker の転送予約マーク('master')を兼ねるため DB列へも即同期する
    if 'encode_dir' in body:
        try:
            db.set_video_encode_dir(video_id, tag.get('encode_dir') or '')
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('patch_video_confirmed: encode_dir DB反映失敗 id=%s: %s', video_id, e)
    return jsonify({'id': video_id})


