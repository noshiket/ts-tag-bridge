"""サーバーを動かす（HTTP/HTTPS・Akebi）"""

import sys
import os
import logging
import logging.handlers
import data_paths
from boot.ports import PortConfigError, backend_port as _backend_port, listen_port


import logging

# main.py と同じ名前でログに出す
logger = logging.getLogger('encode_auto')


def _run_server(app, config):
    """uvicorn でサーバーを動かす。https.enabled なら Akebi(HTTPS リバースプロキシ)を前段に置く。"""
    host = config.get('host', '0.0.0.0')
    port = listen_port(config)

    import uvicorn

    # ── HTTPS/HTTP2 化: Akebi (HTTPS リバースプロキシ) を前段に置く ──
    # config.yml の https.enabled が true のとき、Akebi を {port} で待ち受け、
    # 本体 uvicorn は https.backend_port で動かして Akebi から転送する。
    https_cfg = config.get('https') or {}
    if https_cfg.get('enabled'):
        import subprocess, atexit
        try:
            backend_port = _backend_port(config)
        except PortConfigError as e:
            logger.error('%s', e)
            print(f'[ERROR] {e}', file=sys.stderr)
            sys.exit(1)
        default_akebi = os.path.join(data_paths.SERVER_DIR, 'thirdparty', 'Akebi', 'akebi-https-server')
        akebi_path = https_cfg.get('akebi_path') or default_akebi

        akebi_args = [
            akebi_path,
            '--listen-address', f'{host}:{port}',
            '--proxy-pass-url', f'http://127.0.0.1:{backend_port}/',
        ]
        # カスタム証明書が指定されていればそれを使い、無ければ Keyless Server で署名する
        cert = https_cfg.get('custom_certificate')
        key = https_cfg.get('custom_private_key')
        if cert and key:
            akebi_args += ['--custom-certificate', str(cert), '--custom-private-key', str(key)]
        else:
            akebi_args += ['--keyless-server-url', https_cfg.get('keyless_server_url', 'https://akebi.konomi.tv/')]

        if not os.path.exists(akebi_path):
            logger.error('Akebi バイナリが見つかりません: %s (https.akebi_path を設定してください)', akebi_path)
            sys.exit(1)

        # 前回の(孤児化した)Akebi が同じ待受ポートを掴んでいたら終了させる
        # （SIGTERM 終了時に atexit が走らず Akebi が残ることがあるため、起動時にも保険で掃除する）
        try:
            subprocess.run(['pkill', '-f', f'akebi-https-server --listen-address {host}:{port}'], check=False)
            import time as _t; _t.sleep(1)
        except Exception:
            pass

        akebi_log = open(os.path.join(data_paths.DATA_DIR, 'akebi.log'), 'w', encoding='utf-8')
        proxy = subprocess.Popen(akebi_args, stdout=akebi_log, stderr=akebi_log)
        atexit.register(lambda: proxy.terminate())
        logger.info('Akebi HTTPS reverse proxy started: %s', ' '.join(akebi_args))
        print(f"[encode_auto] starting on https://{host}:{port} (Akebi → uvicorn 127.0.0.1:{backend_port})")
        # log_config=None: uvicorn の logging.dictConfig による root ロガー上書きを抑止し、
        # 上で設定した basicConfig（ファイル出力）と RingBufferHandler（GUI のアプリログ表示元）を維持する。
        uvicorn.run(app, host='127.0.0.1', port=backend_port, log_config=None)
    else:
        print(f"[encode_auto] starting on http://{host}:{port}")
        uvicorn.run(app, host=host, port=port, log_config=None)
