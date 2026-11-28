"""デバッグ用の一括更新・ログ・iOS 用のサムネ"""

import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
    Response,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from .peers import (  # noqa: F401
    _DEBUG_PROGRAMS_COLUMNS,
    _DEBUG_RECORDINGS_COLUMNS,
)


async def _debug_patch(table: str, allowed: set):
    """table の列を一括更新する（デバッグ用）。body: {ids?: [...], fields: {列: 値}}。

    列名は allowed にあるものだけ（SQL に直接埋めるので、ここで必ず絞る）。
    table は呼び出し側が決めた固定の名前だけを渡す。
    """
    body = await _json()
    fields = body.get('fields')
    if not isinstance(fields, dict) or not fields:
        abort(400, description='fields オブジェクトが必要です')

    unknown = set(fields) - allowed
    if unknown:
        abort(400, description=f'更新不可の列: {", ".join(sorted(unknown))}')

    ids = body.get('ids')
    db = _ruledb()
    conn = db._get_conn()

    set_clause = ', '.join(f'{k} = ?' for k in fields)
    values = list(fields.values())

    if ids:
        placeholders = ', '.join('?' * len(ids))
        conn.execute(
            f'UPDATE {table} SET {set_clause} WHERE id IN ({placeholders})',
            values + list(ids),
        )
    else:
        conn.execute(f'UPDATE {table} SET {set_clause}', values)
    conn.commit()

    affected = conn.execute('SELECT changes()').fetchone()[0]
    return jsonify({'updated': affected})


@bp.post('/debug/recordings/patch')
async def debug_patch_recordings():
    """recordings テーブルの列を一括更新する（デバッグ用）。

    リクエストボディ:
        {
            "ids":    [1, 2, 3],          // 省略時は全件
            "fields": {"drop_error": null, "state": "found"}
        }
    """
    return await _debug_patch('recordings', _DEBUG_RECORDINGS_COLUMNS)


@bp.post('/debug/programs/patch')
async def debug_patch_programs():
    """programs テーブルの列を一括更新する（デバッグ用）。

    リクエストボディ:
        {
            "ids":    [1, 2, 3],          // 省略時は全件
            "fields": {"state": "pending"}
        }
    """
    return await _debug_patch('programs', _DEBUG_PROGRAMS_COLUMNS)


# ===========================================================================
# アプリログ
# ===========================================================================

@bp.get('/logs')
def get_logs():
    """リングバッファからアプリログを返す。?limit=500&level=ERROR"""
    ring = current_app.config.get('LOG_RING')
    if ring is None:
        return jsonify([])
    limit = request.args.get('limit', 500, type=int)
    level = request.args.get('level')
    return jsonify(ring.get_entries(limit=limit, level=level))


@bp.post('/logs/client')
async def post_client_log():
    """クライアント(プレイヤー)のエラーをサーバーログへ記録する。

    ブラウザ側のエラーは画面に出るだけでサーバーのログリングに残らず、
    「再生開始時にエラーが出た」といった事象を後から追えなかったため。
    body: {message: str, context: dict|None}
    """
    import logging as _lg
    body = await _json()
    message = str(body.get('message') or '')[:1000]
    if not message:
        return jsonify({'ok': False, 'error': 'message is required'}), 400
    context = body.get('context')
    ctx_s = ''
    if isinstance(context, dict) and context:
        ctx_s = ' ' + ' '.join(f'{k}={v}' for k, v in list(context.items())[:20])
    _lg.getLogger('client').error('[client]%s %s', ctx_s, message)
    return jsonify({'ok': True})


@bp.get('/ios/thumbnail-tile/<int:video_id>')
def ios_thumbnail_tile(video_id: int):
    """iOS(WKWebView)向けに、幅を組み替えたシークバー用タイルを返す。

    通常使わない特殊経路なので /api/ios/... に分けて分かりやすくしてある。

    iOS の WebP デコーダは幅16320px（旧仕様の生成分）をデコードできず、
    makeImagePlus: err=-50 で失敗し続ける。元のタイル画像・生成コード・DBは
    一切変更せず、組み替えた別ファイルをこのエンドポイント用にキャッシュする。
    Web側は meta.thumbnail_info.tile の column_count/image_height から
    Math.min(column_count, 25) 列で同じ計算をやり直せば、この画像でも
    タイル位置がズレない（thumbnail_tile_reflow.py の new_layout と同じ式）。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    tile_path = video.get('thumbnail_tile_path')
    if not tile_path or not os.path.exists(tile_path):
        abort(404)

    from logic.thumbnail_tile_reflow import ios_cache_path, build_ios_tile
    cache_path = ios_cache_path(tile_path)
    # 元のタイルを作り直した後（縦長の動画を縦長のコマで作り直した時など）は控えも作り直す
    if not cache_path.exists() or cache_path.stat().st_mtime < os.path.getmtime(tile_path):
        data = build_ios_tile(tile_path)
        if data is None:
            abort(404)
        cache_path.write_bytes(data)
    return Response(cache_path.read_bytes(), mimetype='image/webp',
                    headers={'Cache-Control': 'max-age=86400'})
