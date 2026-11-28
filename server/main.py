#!/usr/bin/env python3
"""encode_auto サーバー 起動エントリーポイント

Usage:
    python main.py [config.yml]
"""

import sys
import os
import logging
import logging.handlers

import yaml
from quart import Quart, jsonify

# server/ ディレクトリを import パスに追加
sys.path.insert(0, os.path.dirname(__file__))
# text_parser の置き場を、何かを読み込む前に決める（data_paths を参照）
import data_paths  # noqa: E402,F401

from api.web import client_files, compression, etag
from api.routes.auth import bp
from api.app_routes import app_bp
from api.auth_routes.auth import auth_bp
from api.fed_routes.common import fed_bp
from api.nodes.node_routes import node_bp
from clients.edcb_api.core import EDCBClient
from boot.ring_log import RingBufferHandler  # noqa: F401
from boot.databases import _open_databases, _startup_housekeeping, _setup_live_stream  # noqa: F401
from boot.background import _start_workers, _start_background_threads  # noqa: F401
from boot.serve import _run_server  # noqa: F401
from boot.log_settings import apply_log_settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(name)s %(levelname)s: %(message)s',  # boot/log_settings.py の _FORMAT と同じ
)
logger = logging.getLogger('encode_auto')


def load_config(path: str = 'config.yml') -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    _fill_default_ffmpeg_paths(config)
    return config


def _fill_default_ffmpeg_paths(config: dict) -> None:
    """config.yml に ffmpeg/ffprobe の指定が無ければ同梱版(thirdparty/FFmpeg)を既定にする。

    config.yml は各サーバー個別(gitignore対象)なので、既定値をコード側に置いて
    どのサーバーでも同じバイナリを使うようにする。同梱版が無い環境では従来どおり
    PATH 上の ffmpeg/ffprobe にフォールバックする。明示指定があればそちらを優先する。
    """
    if not isinstance(config, dict):
        return
    base = os.path.join(data_paths.SERVER_DIR, 'thirdparty', 'FFmpeg')
    for key in ('ffmpeg', 'ffprobe'):
        if config.get(key):
            continue
        bundled = os.path.join(base, key)
        config[key] = bundled if os.path.isfile(bundled) else key


def create_app(config: dict) -> Quart:
    app = Quart(__name__)
    # ライブ配信(mpegts)/SSE(events) などの長時間ストリーミングが Quart 既定の
    # RESPONSE_TIMEOUT(60秒) で強制切断され、60秒ごとに再接続・再起動していたため無効化する。
    # BODY_TIMEOUT もキャプチャ等の大きめボディ受信のため無効化。
    app.config['RESPONSE_TIMEOUT'] = None
    app.config['BODY_TIMEOUT'] = None
    # federation ingest (server/api/fed_routes.py) が multi-GB の mp4 を PUT で受け取るため、
    # Quart 既定の 16MiB 上限を解除する。
    app.config['MAX_CONTENT_LENGTH'] = None
    app.config['ENCODE_AUTO'] = config

    # リングバッファログハンドラ（GUI から参照）
    ring_handler = RingBufferHandler(capacity=2000)
    ring_handler.setFormatter(logging.Formatter('%(asctime)s'))
    logging.getLogger().addHandler(ring_handler)
    app.config['LOG_RING'] = ring_handler
    edcb_url = ((config.get('edcb_servers') or [{}])[0].get('url')) or config.get('edcb_url', 'http://localhost:5510')
    app.config['EDCB_CLIENT'] = EDCBClient(edcb_url)
    # 有料の局の一覧（利用者ごとの権限で、有料か分からない物を局の大半で決める）が引く EDCB
    from logic import paid_services
    paid_services.set_client_provider(lambda: app.config['EDCB_CLIENT'])
    app.config['WORKERS'] = {}

    from clients.amatsukaze_api.core import AmatsukazeClient
    amz_url = ((config.get('amatsukaze_servers') or [{}])[0].get('url')) or config.get('Amatsukaze_url', config.get('amatsukaze_url', 'demo'))
    app.config['AMATSUKAZE_CLIENT'] = AmatsukazeClient(amz_url)

    # TextParserStore（SID ごとのパターン設定ディレクトリ）
    tp_dir = os.path.join(data_paths.DATA_DIR, 'text_parser')
    from logic.patterns.parser_store import TextParserStore
    parser_store = TextParserStore(tp_dir)
    app.config['PARSER_STORE'] = parser_store
    logger.info('TextParserStore: %s', tp_dir)

    _open_databases(app, config)
    _startup_housekeeping(app, config)
    _setup_live_stream(app, config)

    app.register_blueprint(bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(fed_bp)
    app.register_blueprint(node_bp)
    app.register_blueprint(app_bp)

    # アプリの Web 版と server/static/ の配信（api/web/client_files.py）
    client_files.install(app)

    # 一覧APIもクライアントのソースも圧縮すると大幅に小さくなる（api/web/compression.py）。
    # ETag は圧縮前の本文から作りたいので compression より後に登録する
    # （after_request は登録の逆順に走るため、実行は etag → compression の順になる）
    compression.install(app)
    etag.install(app)

    # abort(...) の description を JSON で返す。ここに無いコードは Quart 既定の HTML
    # エラーページになり、クライアント(api.jsx の apiFetch)が理由を読めず「HTTP 409」
    # のような数字だけの表示になる。abort で使っているコードは全て並べること。
    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(409)
    @app.errorhandler(500)
    @app.errorhandler(502)
    @app.errorhandler(503)
    def json_error(e):
        return jsonify({'error': e.description}), e.code

    @app.after_serving
    async def shutdown():
        """アプリケーション終了時にライブストリームをクリーンアップ"""
        try:
            from media.tsukujima.live_stream import LiveStream
            await LiveStream.closeAll()
            logger.info('LiveStream cleanup complete')
        except Exception as e:
            logger.warning('LiveStream cleanup failed: %s', e)

    return app


def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else 'config.yml'

    if not os.path.exists(config_path):
        print(f"[ERROR] 設定ファイルが見つかりません: {config_path}")
        print(f"        config.yml.example をコピーして編集してください")
        sys.exit(1)

    config = load_config(config_path)
    apply_log_settings(config)
    app = create_app(config)
    app.config['CONFIG_PATH'] = os.path.abspath(config_path)

    # しょぼいカレンダーの bot 利用規約: User-Agent に連絡先を入れる
    from text_parser import shoboi_api
    shoboi_api.set_contact(config.get('shoboi_contact', ''))

    _start_workers(app, config)
    _start_background_threads(app, config)
    _run_server(app, config)


if __name__ == '__main__':
    main()
