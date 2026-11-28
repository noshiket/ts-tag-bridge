"""アドオンが利用者へ渡すファイル（server/data/addon/<名前>/ の直下）の置き場所と片付け。

ADDON に output_ttl_sec を書いたアドオンだけが対象。コアはアドオンの名前を知らず、
宣言を見て配る・消す（例: 切り抜きの MP4）。下のフォルダ（フォントなど）には触らない。
"""

import logging
import os
import time

import data_paths

logger = logging.getLogger(__name__)


def output_dir(name: str) -> str:
    return os.path.join(data_paths.DATA_DIR, 'addon', name)


def output_ttl(name: str):
    """アドオンが宣言した寿命（秒）。宣言していない・読めないアドオンは None。"""
    from logic.addons import addon_runner
    try:
        _mod, schema, _spdir = addon_runner.load_addon(name)
    except Exception:               # 無い・読み込みに失敗した
        return None
    return schema.get('output_ttl_sec')


def purge_dir(d: str, ttl: int) -> int:
    """d の直下で ttl 秒より古いファイルを消す。戻り値は消した数。"""
    if not os.path.isdir(d):
        return 0
    now, removed = time.time(), 0
    for fname in os.listdir(d):
        p = os.path.join(d, fname)
        try:
            if os.path.isfile(p) and now - os.path.getmtime(p) > ttl:
                os.remove(p)
                removed += 1
        except OSError:
            pass
    return removed


def purge_outputs() -> dict:
    """寿命を宣言した全アドオンについて、過ぎたファイルを消す。{名前: 消した数}"""
    from logic.addons import addon_runner
    out = {}
    for a in addon_runner.list_addons():
        ttl = a.get('output_ttl_sec')
        if ttl:
            out[a['name']] = purge_dir(output_dir(a['name']), ttl)
    return out
