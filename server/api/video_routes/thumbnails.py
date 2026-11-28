"""サムネイル（返す・作り直す・キャプチャから付ける）"""

import data_paths
import os
from quart import jsonify, current_app, request, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.tag_io import _load_tag, _save_tag
from .add_video.media import _generate_video_thumbnails, _serve_image_revalidate
from .confirmed.tag import _video_tag_path


@bp.get('/videos/<int:video_id>/thumbnail')
def get_video_thumbnail(video_id):
    """video.db の thumbnail 画像を返す。
    サムネファイルが見つからない場合は、外部でファイルが移動された可能性があるため、
    現在のマウント先を探して DB のパスを更新（自己修復）してから再取得する。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    path = db.get_video_thumbnail(video_id)
    if not path and db.heal_video_paths(video_id):
        path = db.get_video_thumbnail(video_id)
    if not path:
        abort(404)
    return _serve_image_revalidate(path)


@bp.post('/videos/<int:video_id>/thumbnail/regenerate')
async def regenerate_video_thumbnail(video_id):
    """代表サムネとシークバー用タイルを作り直す（ビデオカードの「…」から）。

    サムネが出ない原因は2通りある:
      1. パスがずれている（話数の付け直しで実ファイルは改名されたのに、tag.json と DB は
         古い名前を指したまま）。この場合は動画の隣にある正しい名前のファイルを拾い直すだけで
         直るので、作り直さない（一瞬で済む）。body の force で作り直しを強制できる。
      2. 本当に無い / 中身がおかしい。この場合は動画から作り直す。数分かかるので
         音声解析と同じ順番待ちのジョブで流す（応答は job_id を返す）。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        abort(404, description='動画が見つかりません')
    path = video.get('file_path') or ''
    if not path or not os.path.exists(path):
        abort(404, description='動画ファイルが見つかりません')
    body = await _json()
    force = bool(body.get('force'))

    stem = os.path.splitext(path)[0]
    thumb, tile = stem + '.thumbnail.webp', stem + '.thumbnail_tile.webp'
    tag = _load_tag(tag_path) if tag_path else None
    if tag is None:
        tag = {'app_output_path': path}

    # 1. パスのずれ: 動画の隣に正しい名前のサムネがあるのに、DB/tag が別のものを指している
    if not force and os.path.exists(thumb) and video.get('thumbnail_path') != thumb:
        fields = {'thumbnail_path': thumb}
        if os.path.exists(tile):
            fields['thumbnail_tile_path'] = tile
        tag.update(fields)
        _save_tag(path + '.tag.json', tag)
        db.update_video(video_id, **fields)
        return jsonify({'fixed': 'path', 'thumbnail_path': thumb})

    # 2. 作り直し（動画を走査するので数分かかる）
    from logic import audio_compare
    cfg = dict(current_app.config['ENCODE_AUTO'])
    name = video.get('eit_title') or video.get('episode_name') or f'video {video_id}'

    def _run(log, finish):
        log(f'{name} のサムネイルを作り直しています')
        made = _generate_video_thumbnails(db, video_id, path, tag, config=cfg)
        if not made:
            raise RuntimeError('サムネイルを作れませんでした（動画を読めない可能性があります）')
        log('完了しました: ' + ' / '.join(made))
        finish('done', result={'made': made})

    job_id = audio_compare.start_job('thumbnail', video_id, {'name': name}, _run)
    return jsonify({'job_id': job_id})


@bp.post('/videos/<int:video_id>/thumbnail/from-capture')
async def set_video_thumbnail_from_capture(video_id):
    """キャプチャ画像を元サムネと同じ解像度・拡張子に変換して代表サムネを差し替える。
    body: { file: 'キャプチャファイル名' }
    """
    import pathlib, cv2
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        return jsonify({'error': 'video not found'}), 404
    thumb_path = video.get('thumbnail_path')
    if not thumb_path or not os.path.exists(thumb_path):
        return jsonify({'error': 'no existing thumbnail to match'}), 400

    data = await request.get_json(silent=True) or {}
    fname = pathlib.Path(str(data.get('file', ''))).name   # ディレクトリトラバーサル防止
    if not fname:
        return jsonify({'error': 'file required'}), 400
    cap_path = pathlib.Path(data_paths.DATA_DIR) / 'captures' / fname
    if not cap_path.is_file():
        return jsonify({'error': 'capture not found'}), 404

    # 元サムネの解像度・拡張子に合わせて変換し上書き
    orig = cv2.imread(thumb_path)
    cap = cv2.imread(str(cap_path))
    if orig is None or cap is None:
        return jsonify({'error': 'failed to read image'}), 500
    h, w = orig.shape[:2]
    resized = cv2.resize(cap, (w, h), interpolation=cv2.INTER_AREA)
    ext = os.path.splitext(thumb_path)[1].lower()
    params = [cv2.IMWRITE_WEBP_QUALITY, 80] if ext == '.webp' else []
    if not cv2.imwrite(thumb_path, resized, params):
        return jsonify({'error': 'failed to write thumbnail'}), 500
    db.touch_video(video_id)   # updated_at 更新 → ライブラリのキャッシュバスター用
    return jsonify({'ok': True})


@bp.get('/videos/albums/<int:album_id>/thumbnail')
def get_album_thumbnail(album_id):
    """album 内の最新 video のサムネイル画像を返す。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    path = db.get_album_latest_thumbnail(album_id)
    if not path:
        abort(404)
    return _serve_image_revalidate(path)


@bp.get('/videos/series/<int:series_id>/thumbnail')
def get_series_thumbnail(series_id):
    """series に設定されたサムネイル画像を返す。

    設定していなければ series 内の最新 video のサムネで代用する（album と同じ扱い）。
    音楽はアルバム(series)のジャケットが各曲のサムネなので、これで実際の絵が出る。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    series = db.get_series_row(series_id)
    path = series and series.get('thumbnail_path')
    if not path or not os.path.exists(path):
        path = db.get_series_latest_thumbnail(series_id)
    if not path:
        abort(404)
    return _serve_image_revalidate(path)


@bp.post('/videos/series/<int:series_id>/thumbnail/from-capture')
async def set_series_thumbnail_from_capture(series_id):
    """キャプチャ画像を通常の代表サムネと同じ解像度・WebP品質(480x270, quality=80)に圧縮し、
    専用ファイルとしてデータの置き場の series_thumbnails/ に保存してseriesのサムネイルに設定する。
    body: { file: 'キャプチャファイル名' }
    """
    import pathlib, cv2
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    series = db.get_series_row(series_id)
    if series is None:
        return jsonify({'error': 'series not found'}), 404

    data = await request.get_json(silent=True) or {}
    fname = pathlib.Path(str(data.get('file', ''))).name   # ディレクトリトラバーサル防止
    if not fname:
        return jsonify({'error': 'file required'}), 400
    cap_path = pathlib.Path(data_paths.DATA_DIR) / 'captures' / fname
    if not cap_path.is_file():
        return jsonify({'error': 'capture not found'}), 404

    cap = cv2.imread(str(cap_path))
    if cap is None:
        return jsonify({'error': 'failed to read image'}), 500
    # 通常の代表サムネ(ThumbnailGenerator)と同じ解像度/品質設定に合わせる
    resized = cv2.resize(cap, (480, 270), interpolation=cv2.INTER_AREA)

    out_dir = pathlib.Path(data_paths.DATA_DIR) / 'series_thumbnails'
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f'series_{series_id}.thumbnail.webp'
    if not cv2.imwrite(str(out_path), resized, [cv2.IMWRITE_WEBP_QUALITY, 80]):
        return jsonify({'error': 'failed to write thumbnail'}), 500

    db.set_series_thumbnail(series_id, str(out_path))
    return jsonify({'ok': True})
