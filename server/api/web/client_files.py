"""アプリ（apps/app）の Web 版と、サーバーが配るファイル（server/static/）の配信。

Web 版（アプリで `npx expo export --platform web --output-dir dist` を書き出した物）を / に出す。
置き場は config.yml の web_dir（相対パスは server/ から）。空なら apps/app/dist。
server/static/ には、書き出しに入らずサーバーが配る物を置く:
- vendor/ … ライブ画面の WebView が読むライブラリ（mpegts.js・aribb24・danmaku）
- jikkyo.js … ライブ画面の実況コメント。入っているアプリが /src/jikkyo.jsx で読むので、その URL で出す
- manifest.json・icon-*.png … ホーム画面に追加した時の名前とアイコン
- sw.js … 前の Web 版が入れた Service Worker を片付けるだけのもの

前の Web 版（jsx）と前の iOS アプリはもう配らない。
もとは main.py の create_app の中にあった。
"""

import pathlib

from quart import Response, jsonify, send_from_directory

import data_paths

_NOT_EXPORTED = ('Web 版がまだ書き出されていません。アプリで npx expo export --platform web --output-dir dist を'
                 '実行し、書き出した dist を config.yml の web_dir（空なら apps/app/dist）に置いてください。\n')


def web_dir(config: dict) -> pathlib.Path:
    """Web 版の置き場（config.yml の web_dir。相対パスは server/ から。空なら apps/app/dist）"""
    server = pathlib.Path(data_paths.SERVER_DIR)
    d = (config or {}).get('web_dir') or ''
    return (server / d).resolve() if d else server.parent / 'apps' / 'app' / 'dist'


def install(app):
    static_dir = pathlib.Path(data_paths.SERVER_DIR) / 'static'
    next_dir = web_dir(app.config.get('ENCODE_AUTO'))

    def _has_next() -> bool:
        return (next_dir / 'index.html').is_file()

    async def _next_index():
        if not _has_next():
            return Response(_NOT_EXPORTED, status=503, content_type='text/plain; charset=utf-8')
        # 中の JS はファイル名に版が入るので、入口の HTML だけ毎回取り直させる
        resp = await send_from_directory(str(next_dir), 'index.html')
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp

    async def _static(rel: str, cache: str = 'no-cache', mimetype: str | None = None):
        # no-cache: 毎回「変わったか」だけ確かめさせる（変わっていなければ中身は送らない）
        resp = await send_from_directory(str(static_dir), rel, mimetype=mimetype)
        resp.headers['Cache-Control'] = cache
        return resp

    @app.get('/')
    async def index():
        return await _next_index()

    # Web 版の中身（JS・画像・フォント）。名前に版が入るので長く持たせてよい
    @app.get('/_expo/<path:filename>')
    async def next_expo(filename):
        resp = await send_from_directory(str(next_dir / '_expo'), filename)
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp

    @app.get('/assets/<path:filename>')
    async def next_assets(filename):
        resp = await send_from_directory(str(next_dir / 'assets'), filename)
        resp.headers['Cache-Control'] = 'public, max-age=86400'
        return resp

    @app.get('/vendor/<path:filename>')
    async def static_vendor(filename):
        return await _static(f'vendor/{filename}')

    @app.get('/src/jikkyo.jsx')
    async def static_jikkyo():
        return await _static('jikkyo.js', mimetype='application/javascript')

    @app.get('/manifest.json')
    async def pwa_manifest():
        return await _static('manifest.json')

    @app.get('/icon-<int:size>.png')
    async def pwa_icon(size):
        return await _static(f'icon-{size}.png', cache='public, max-age=86400')

    # スコープの都合でルート直下に置く。差し替えが届かなくならないよう必ず no-store
    @app.get('/sw.js')
    async def pwa_service_worker():
        return await _static('sw.js', cache='no-cache, no-store, must-revalidate',
                             mimetype='application/javascript')

    # アプリの画面の URL（/live・/watch/123 など）。どれも同じ入口の HTML を返し、画面はアプリが決める。
    # 他に当たる口が無い時だけここへ来る（/api などの決まった口が先に当たる）
    @app.get('/<path:subpath>')
    async def next_fallback(subpath):
        if subpath.startswith('api/'):
            return jsonify({'error': 'not found'}), 404
        f = next_dir / subpath
        if _has_next() and f.is_file() and next_dir in f.resolve().parents:
            return await send_from_directory(str(next_dir), subpath)
        return await _next_index()
