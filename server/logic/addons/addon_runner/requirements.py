"""アドオンの依存（requirements.txt を読む・入れる）"""

import os
import re
import sys
import subprocess
from .discovery import _find_entry, logger


def _requirements_path(name):
    """ディレクトリ形式のアドオンに置かれた requirements.txt のパス。無ければ None。"""
    entry, spdir = _find_entry(name)
    if not spdir:
        return None                     # 単一ファイルのアドオンは対象外
    p = os.path.join(spdir, 'requirements.txt')
    return p if os.path.isfile(p) else None


def _parse_requirements(path):
    """requirements.txt → [{'line', 'name'}]。コメント・空行は無視する。"""
    out = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.split('#', 1)[0].strip()
                if not line or line.startswith('-'):
                    continue
                # 'Pillow>=10.0' / 'pkg[extra]==1.2' → 'Pillow'
                name = re.split(r'[<>=!~\[; ]', line, 1)[0].strip()
                if name:
                    out.append({'line': line, 'name': name})
    except OSError:
        pass
    return out


def requirements_of(name):
    """アドオンの追加依存と導入状況。requirements.txt が無ければ None。"""
    path = _requirements_path(name)
    if not path:
        return None
    from importlib.metadata import PackageNotFoundError, version as _ver
    items = []
    for req in _parse_requirements(path):
        try:
            items.append({**req, 'installed': True, 'version': _ver(req['name'])})
        except PackageNotFoundError:
            items.append({**req, 'installed': False, 'version': None})
        except Exception:
            items.append({**req, 'installed': False, 'version': None})
    return {'path': path, 'items': items,
            'ok': all(i['installed'] for i in items) if items else True}


def install_requirements(name, timeout: int = 600):
    """アドオンの requirements.txt を今の Python 環境へ入れる。

    戻り値 {'ok': bool, 'log': str}。サーバーと同じ interpreter の pip を使う
    (venv の外へ入れてしまわないため)。
    """
    path = _requirements_path(name)
    if not path:
        return {'ok': False, 'log': 'requirements.txt がありません'}
    cmd = [sys.executable, '-m', 'pip', 'install', '-r', path]
    logger.info('アドオン %s の依存を導入します: %s', name, ' '.join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout, text=True)
    except Exception as e:
        return {'ok': False, 'log': f'実行できませんでした: {e}'}
    log = (r.stdout or '') + (r.stderr or '')
    ok = r.returncode == 0
    logger.info('アドオン %s の依存導入: %s', name, '成功' if ok else '失敗')
    return {'ok': ok, 'log': log[-4000:]}
