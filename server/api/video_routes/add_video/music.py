"""音楽の取り込み（中身の確認・始める・置き場所）"""

import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from ..library.manual_defaults import _upload_roots
from ..confirmed.tag_paths import _manual_dest_path, music_default_dir
from logic.encoding import load_weights


def _music_dest_fn(config, encode_dir: str):
    """音楽の置き場所を決める関数を返す。

    決め方は動画の手入力追加と同じ app_output_path_format の展開(_manual_dest_path)。
    テンプレートは tag に入っている（logic.music.music_tags.OUTPUT_FORMAT）。
    未指定なら既定の保存先へ入れる（動画と揃える）。'keep' を渡した時だけ原本の隣に置く。
    """
    if encode_dir == 'keep':
        return None
    if not encode_dir:
        encode_dir = music_default_dir(config)
        if not encode_dir:
            return None      # encode_dir_list が空。原本の隣に置くしかない
    roots = _upload_roots(config)
    real = os.path.realpath(encode_dir)
    if not roots or not any(real == r or real.startswith(r + os.sep) for r in roots):
        abort(400, description='保存先は encode_dir_list 配下のディレクトリを指定してください')

    def _dest(tag):
        # 拡張子は再生用MP4のもの。原本(.aiff)を渡すと {$ext} が .aiff になってしまう
        path, _template = _manual_dest_path(config, tag, 'x.mp4', encode_dir)
        if not path or '{$' in path:
            raise ValueError(f'置き場所を決められません（未解決の項目があります）: {path}')
        tag['encode_dir'] = encode_dir
        return path
    return _dest


@bp.post('/videos/music/scan')
async def music_scan():
    """フォルダを見て取り込める音声ファイルを並べる（何も書かない）。

    body: {dir, encode_dir(任意)}
    埋め込みタグ(アーティスト/アルバム/曲名/トラック番号)と、encode_dir を指定した場合の
    置き場所を返すので、取り込み前に「どう分類されてどこへ入るか」を確認できる。
    """
    from logic.music import music_import

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    root = (body.get('dir') or '').strip()
    if not root or not os.path.isdir(root):
        abort(400, description=f'フォルダが見つかりません: {root}')
    cfg = current_app.config['ENCODE_AUTO']
    dest_fn = _music_dest_fn(cfg, (body.get('encode_dir') or '').strip())
    out = []
    for src in music_import.scan_dir(root):
        try:
            tag = music_import.plan(cfg.get('ffprobe', 'ffprobe'), src, dest_fn)
        except ValueError as e:
            out.append({'path': src, 'error': str(e)})
            continue
        out.append({
            'path': src, 'artist': tag['artist'], 'album': tag['title'],
            'track': tag.get('episode_number'), 'title': tag['episode_name'],
            'duration_sec': tag.get('duration_sec'), 'cover': bool(tag.get('_cover')),
            'dest': tag['app_output_path'],
            # 置き場所が同じ or 同じ曲(CDのTOC+トラック番号 等)が既に入っている
            'registered': (db.find_video_by_path(tag['app_output_path']) is not None
                           or db.find_video_by_music_key(tag.get('music_key') or '') is not None),
        })
    return jsonify({'dir': root, 'files': out})


@bp.post('/videos/music/import')
async def music_import_start():
    """音楽をまとめて取り込む（変換 → tag.json → 登録）。順番待ちのジョブで流す。

    body: {dir} または {files: [パス, ...]}
    進捗は /api/audio-compare/jobs/<id>（音声解析と同じ順番待ちに載せている）。
    """
    from logic.music import music_import
    from logic.music import music_tags  # noqa: F401

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    files = [f for f in (body.get('files') or []) if f]
    if not files:
        root = (body.get('dir') or '').strip()
        if not root or not os.path.isdir(root):
            abort(400, description=f'フォルダが見つかりません: {root}')
        files = music_import.scan_dir(root)
    files = [f for f in files if os.path.isfile(f) and music_import.is_audio(f)
             and not music_import.is_generated(os.path.basename(f))]
    if not files:
        abort(400, description='取り込める音声ファイルがありません')
    cfg = current_app.config['ENCODE_AUTO']
    job_id = music_import.start_import(
        db, cfg.get('ffmpeg', 'ffmpeg'), cfg.get('ffprobe', 'ffprobe'), files,
        dest_fn=_music_dest_fn(cfg, (body.get('encode_dir') or '').strip()),
        nice=load_weights.audio_sync_params(cfg)['nice'])
    return jsonify({'job_id': job_id, 'count': len(files)})
