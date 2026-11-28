"""キャプチャ（/api/streams/captures/*）"""

import data_paths
from quart import (
    jsonify,
    current_app,
    request,
    abort,
    Response,
)
from api.routes.auth import bp  # noqa: F401
from api.stream_routes.capture_owner import me, require_visible, visible


@bp.get('/streams/captures/<path:filename>/download')
def download_capture(filename):
    """キャプチャ画像をダウンロードとして配信する（メタデータは保存時に埋め込み済み）。"""
    import pathlib
    cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
    fpath = cap_dir / pathlib.Path(filename).name
    if not fpath.is_file():
        abort(404)
    require_visible(current_app.config.get('VIDEO_DB'), fpath.name)
    # 画像は小さいので既存の配信(get_capture)と同じく素直に読み込んで返す
    return Response(fpath.read_bytes(), mimetype='application/octet-stream',
                    headers={'Content-Disposition': f'attachment; filename="{fpath.name}"'})


@bp.post('/streams/captures/import')
async def import_captures():
    """埋め込みメタデータ付きのキャプチャ画像を取り込んで captures を復元する。

    body: { files: [{ name, image: 'data:image/...;base64,...' }, ...] }
    画像に埋めた EIT/TOT から行を作り、同じ番組の動画が既にあれば紐づける。
    メタデータが無い画像はファイルを置くだけ（行は作らない）。
    """
    import base64, pathlib
    from logic.meta import media_meta  # noqa: F401
    from logic.meta import image_meta
    body = await request.get_json(silent=True) or {}
    files = body.get('files') or []
    if not isinstance(files, list) or not files:
        return jsonify({'error': 'files が空です'}), 400

    db = current_app.config.get('VIDEO_DB')
    cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
    cap_dir.mkdir(parents=True, exist_ok=True)
    imported, linked, skipped, errors = [], 0, [], []

    for f in files[:500]:
        name = pathlib.Path(str(f.get('name') or '')).name
        image = str(f.get('image') or '')
        if not name or not image.startswith('data:image/'):
            errors.append(f'{name or "(名前なし)"}: 画像ではありません')
            continue
        try:
            raw = base64.b64decode(image.split(',', 1)[1])
        except Exception:
            errors.append(f'{name}: デコードに失敗しました')
            continue
        dest = cap_dir / name
        if dest.exists():
            skipped.append(name)          # 同名は上書きしない
            continue
        meta = image_meta.read_image_meta(raw) or {}
        cap = meta.get('capture') if meta.get('kind') == 'capture' else None
        try:
            dest.write_bytes(raw)
        except Exception as e:
            errors.append(f'{name}: 保存に失敗しました ({e})')
            continue
        if not cap or db is None:
            imported.append({'file': name, 'capture_id': None, 'video_id': None})
            continue
        video = db.find_video_by_event(cap.get('onid'), cap.get('tsid'), cap.get('sid'),
                                       cap.get('eid'), cap.get('tot'))
        cap_id = db.add_capture(
            name, video_id=(video or {}).get('id'), tot=cap.get('tot'),
            onid=cap.get('onid'), tsid=cap.get('tsid'), sid=cap.get('sid'), eid=cap.get('eid'),
            eit_title=cap.get('eit_title'), eit_description=cap.get('eit_description'),
            eit_extended_info=cap.get('eit_extended_info'),
            eit_start_time=cap.get('eit_start_time'), eit_end_time=cap.get('eit_end_time'),
            eit_station_name=cap.get('eit_station_name'), owner=me())
        if video:
            linked += 1
        imported.append({'file': name, 'capture_id': cap_id, 'video_id': (video or {}).get('id')})

    return jsonify({'imported': imported, 'linked': linked,
                    'skipped': skipped, 'errors': errors})


@bp.get('/streams/captures')
def list_captures():
    """保存済みキャプチャの一覧（新しい順）。

    ファイル実体に video.db の captures 行（video_id / tot / 番組情報）を突き合わせて返す。
    「この位置から再生」に video_id と tot が要るため、ファイル名だけでは足りない。
    DB 行が無いファイル（旧データ・手動配置）も file だけで返す。
    """
    import pathlib
    cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
    if not cap_dir.is_dir():
        return jsonify([])
    files = [p for p in cap_dir.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png')]

    rows = {}
    db = current_app.config.get('VIDEO_DB')
    if db is not None:
        try:
            rows = {r['path']: r for r in db.get_captures_index()}
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('list_captures: captures取得に失敗: %s', e)

    # 追加順(新しい順)。ファイル名順だと作品名の並びになってしまうので created_at で並べる。
    # DB行の無い旧データ・手動配置はファイルの更新時刻で代用する
    import datetime as _dt
    out = []
    for p in files:
        f = p.name
        r = rows.get(f) or {}
        if not visible(r.get('owner')):
            continue                      # 他のアカウントの物（持ち主の無い物は管理者だけ）
        added = r.get('created_at') or _dt.datetime.fromtimestamp(p.stat().st_mtime).isoformat()
        out.append({
            'added_at': added,
            'file': f,
            'id': r.get('id'),
            'video_id': r.get('video_id'),
            'tot': r.get('tot'),
            'eit_title': r.get('eit_title'),
            'eit_station_name': r.get('eit_station_name'),
            'created_at': r.get('created_at'),
            # 一覧をアルバムごとにまとめるために付ける（未紐づけは None）
            'album_id': r.get('album_id'),
            'album': r.get('album_name'),
        })
    out.sort(key=lambda x: x['added_at'], reverse=True)
    return jsonify(out)


@bp.get('/streams/captures/<path:filename>')
def get_capture(filename):
    """保存済みキャプチャ画像を配信する。"""
    import pathlib
    cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
    fpath = cap_dir / pathlib.Path(filename).name   # ディレクトリトラバーサル防止
    if not fpath.is_file():
        abort(404)
    require_visible(current_app.config.get('VIDEO_DB'), fpath.name)
    mime = 'image/png' if fpath.suffix.lower() == '.png' else 'image/jpeg'
    return Response(fpath.read_bytes(), mimetype=mime)


@bp.delete('/streams/captures/<path:filename>')
def delete_capture(filename):
    """保存済みキャプチャを削除する。"""
    import pathlib
    cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
    safe_name = pathlib.Path(filename).name   # ディレクトリトラバーサル防止
    fpath = cap_dir / safe_name
    if not fpath.is_file():
        abort(404)
    require_visible(current_app.config.get('VIDEO_DB'), safe_name)
    try:
        fpath.unlink()
    except Exception as e:
        return jsonify({'error': f'delete failed: {e}'}), 500
    db = current_app.config.get('VIDEO_DB')
    if db is not None:
        # captures.path はファイル名のみを保持している(add_capture呼び出し側と統一)ため、
        # フルパスではなくファイル名で削除する。
        db.delete_capture_by_path(safe_name)
    return jsonify({'ok': True})


# ──────────────────────────────────────────────────────────────
# 録画再生ストリーミング (Video Streaming)
# ──────────────────────────────────────────────────────────────
# 仮想HLS + オンデマンドセグメントエンコード方式（KonomiTV VideoStreamsRouter 相当）。
# rec_id は recordings.id（thumbnail/probe と同じ db_rec_id）。


# ── HLS 配信（録画 /streams/video と video.db の動画 /streams/vdb で共通） ──
# 違うのは元の映像の作り方(build_source)だけ。セッションが出来てからは同じ。


