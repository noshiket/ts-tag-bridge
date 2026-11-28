"""ログの細かさ（log_debug）とファイルへの書き込み（log_file）。どちらも既定はオフ。

起動時と、設定の画面で変えた時（再起動なしで当たる）に apply_log_settings を呼ぶ。

通常（log_debug: false）: 録画の追加・エンコードの始まりと終わり・予約の同期で直したことなど、出来事と異常。
デバッグ（log_debug: true）: 調べ物のための行も出す。毎分のアドオンの実行、エンコードの進み具合（%）、
  各段の細かい完了、一覧作りの時間の計測、アプリから届く計測・状態、1リクエストごとのアクセスログ。
  コードでは logger.debug で出す。

ファイル（log_file: true）: log_file_path に書く（空なら server/data/logs/server.log）。再起動しても消えず、
  10MB を超えたら古い分から捨てる（5本まで）。起動スクリプトが流している /tmp/ts-tag-bridge.log はこれとは別で、
  サーバーが落ちた時のエラーはそちらにしか出ないので、オフにしてもそちらは止めない。
"""

import logging
import logging.handlers
import os

from data_paths import DATA_DIR

DEFAULT_LOG_PATH = os.path.join(DATA_DIR, 'logs', 'server.log')
_FORMAT = '%(asctime)s %(name)s %(levelname)s: %(message)s'
_file_handler: logging.Handler | None = None


def apply_log_settings(config: dict) -> None:
    global _file_handler
    debug = bool(config.get('log_debug', False))
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    # 1リクエストごとに1行出て、ログの半分を占めていた
    logging.getLogger('uvicorn.access').setLevel(logging.DEBUG if debug else logging.WARNING)
    # 使っているライブラリの debug は、こちらの調べ物には要らないので出さない
    for name in ('urllib3', 'asyncio', 'PIL', 'multipart', 'hpack', 'charset_normalizer'):
        logging.getLogger(name).setLevel(logging.INFO)

    path = log_path(config) if config.get('log_file', False) else None
    if _file_handler is not None and _file_handler.baseFilename != path:
        root.removeHandler(_file_handler)   # オフにした・書く場所を変えた
        _file_handler.close()
        _file_handler = None
    if path and _file_handler is None:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            h = logging.handlers.RotatingFileHandler(path, maxBytes=10 * 1024 * 1024, backupCount=5,
                                                     encoding='utf-8')
        except OSError as e:
            logging.getLogger(__name__).error('ログのファイルを開けません: %s: %s', path, e)
            return
        h.setFormatter(logging.Formatter(_FORMAT))
        root.addHandler(h)
        _file_handler = h


def log_path(config: dict) -> str:
    """ログを書くファイル。log_file_path が空なら server/data/logs/server.log"""
    p = str(config.get('log_file_path') or '').strip()
    return os.path.abspath(os.path.expanduser(p)) if p else DEFAULT_LOG_PATH
