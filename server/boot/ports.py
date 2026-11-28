"""待ち受けるポート（config.yml の port と https.backend_port）。ポートの既定値はここにだけ置く。

- port: 外から入るポート。HTTPS の時は前段の Akebi が待ち、そうでなければ本体が待つ
- https.backend_port: HTTPS の時に本体（uvicorn）が 127.0.0.1 で待つポート。Akebi はここへ渡す。
  HTTPS を使うなら必ず書く（以前は port + 10 の決め打ちだった）

シェルからも使う: python boot/ports.py [config.yml] → 「外のポート 本体のポート」を1行で出す
（再起動・停止・見張りのスクリプトが、本体へ直接たずねる時のポートを知るため）
"""

import sys

DEFAULT_PORT = 8082


class PortConfigError(ValueError):
    """config.yml のポートの書き方が足りない・おかしい"""


def listen_port(config: dict) -> int:
    return int(config.get('port') or DEFAULT_PORT)


def https_enabled(config: dict) -> bool:
    return bool((config.get('https') or {}).get('enabled'))


def backend_port(config: dict) -> int:
    """本体が待つポート。HTTPS でなければ外のポートと同じ。"""
    if not https_enabled(config):
        return listen_port(config)
    raw = (config.get('https') or {}).get('backend_port')
    if not raw:
        raise PortConfigError('https.enabled なのに https.backend_port がありません。'
                              'config.yml の https に backend_port（本体が待つポート）を書いてください')
    port = int(raw)
    if port == listen_port(config):
        raise PortConfigError(f'https.backend_port（{port}）が port と同じです。別のポートにしてください')
    return port


if __name__ == '__main__':
    import yaml
    with open(sys.argv[1] if len(sys.argv) > 1 else 'config.yml', encoding='utf-8') as f:
        cfg = yaml.safe_load(f) or {}
    try:
        print(listen_port(cfg), backend_port(cfg))
    except PortConfigError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
