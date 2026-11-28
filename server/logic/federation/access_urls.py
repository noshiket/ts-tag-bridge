"""このサーバーへ入れる URL（相手のサーバーやスマホから）。

HTTPS（Akebi・自前の証明書なし）なら、IP をハイフンにした *.local.konomi.tv の名前で正規の証明書になる。
LAN（192.168 / 10）と Tailscale（100）の IP だけを出す（127.0.0.1 は相手から入れない）。
"""

import subprocess

from boot.ports import https_enabled, listen_port


def _ips() -> list:
    try:
        out = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return []
    return [ip for ip in out.split() if ip.count('.') == 3 and ip.startswith(('192.168.', '10.', '100.'))]


def access_urls(config: dict) -> list:
    port = listen_port(config)
    https = config.get('https') or {}
    keyless = https_enabled(config) and not (https.get('custom_certificate') and https.get('custom_private_key'))
    urls = []
    for ip in _ips():
        if keyless:
            urls.append(f"https://{ip.replace('.', '-')}.local.konomi.tv:{port}")
        else:
            urls.append(f"{'https' if https_enabled(config) else 'http'}://{ip}:{port}")
    return sorted(set(urls), key=urls.index)
