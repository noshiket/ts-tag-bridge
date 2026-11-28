"""つながるか・書き込めるかの確かめ（答えをその場で確かめて、間違いに早く気づけるように）。"""

import os
import shutil
import socket
import urllib.error
import urllib.request
from urllib.parse import urlparse


def http_ok(url: str) -> bool:
    """HTTP で応答があるか（エラーの応答でも、相手がいれば届いている）"""
    try:
        urllib.request.urlopen(url, timeout=3)
        return True
    except urllib.error.HTTPError:
        return True
    except (OSError, ValueError):
        return False


def tcp_ok(url: str) -> bool:
    """tcp://ホスト:ポート に届くか"""
    u = urlparse(url)
    try:
        with socket.create_connection((u.hostname, u.port), timeout=3):
            return True
    except (OSError, TypeError, ValueError):
        return False


def tcp_url_for(http_url: str, port: int = 4510) -> str:
    """EDCB の HTTP の場所から、同じ機械の TCP の場所を作る"""
    host = urlparse(http_url).hostname or 'localhost'
    return f'tcp://{host}:{port}'


def dir_state(path: str) -> str:
    """置き場の様子を1行で（無い・書けない・空き）"""
    if not os.path.isdir(path):
        return 'まだありません'
    if not os.access(path, os.W_OK):
        return '書き込めません'
    free = shutil.disk_usage(path).free / 1024 ** 3
    return f'書き込めます（空き {free:,.0f}GB）'


def make_dir(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except OSError:
        return False
