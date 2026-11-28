"""アドオンを探して読み込む（server/addon/ の .py か、main.py を持つフォルダ）。毎回読み直す"""

import data_paths  # server/ と server/data の場所
import importlib.util
import logging
import os
import sys

logger = logging.getLogger('logic.addons.addon_runner')   # 分ける前と同じ名前で出す

ADDON_DIR = os.path.join(data_paths.SERVER_DIR, 'addon')


def _addon_entries():
    """(name, entry_path, sys_path_dir|None) を列挙する。"""
    if not os.path.isdir(ADDON_DIR):
        return []
    out = []
    for name in sorted(os.listdir(ADDON_DIR)):
        if name.startswith('_') or name.startswith('.'):
            continue
        p = os.path.join(ADDON_DIR, name)
        if os.path.isfile(p) and name.endswith('.py'):
            out.append((name[:-3], p, None))
        elif os.path.isdir(p) and os.path.isfile(os.path.join(p, 'main.py')):
            # ディレクトリ形式: 実行中は同梱モジュール(import helper 等)のため
            # そのディレクトリを sys.path に一時追加する
            out.append((name, os.path.join(p, 'main.py'), p))
    return out


def _load_module(name, entry_path, sys_path_dir):
    """アドオンモジュールを毎回新規ロードする(ホットリロード)。"""
    if sys_path_dir and sys_path_dir not in sys.path:
        sys.path.insert(0, sys_path_dir)
    try:
        spec = importlib.util.spec_from_file_location(f'_tstag_addon_{name}', entry_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        if sys_path_dir:
            try:
                sys.path.remove(sys_path_dir)
            except ValueError:
                pass


def _find_entry(name):
    for n, entry, spdir in _addon_entries():
        if n == name:
            return entry, spdir
    return None, None
