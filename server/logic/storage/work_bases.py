"""エンコードの作業フォルダを置いた場所（tmp_base 以外）の記録。

作業フォルダは普通 config の tmp_base の下に作るが、録画詳細のエンコード設定で
直接別の場所（例 /mnt/ssd/raw/{$tmp_dirs}/cut.ts）を書くとそこに作られる。
エンコード履歴から消える時の掃除や孤児フォルダの掃除が tmp_base しか見ていなかったため、
そうした作業フォルダが消されずに残り続けた（実測 4本 416GB）。使った場所をここに覚えておき、
掃除はそれらも探す。
"""

import json
import logging
import os
import threading

import data_paths  # server/ と server/data の場所

logger = logging.getLogger(__name__)
_lock = threading.Lock()


def _path() -> str:
    return os.path.join(data_paths.DATA_DIR, 'work_bases.json')


def tmp_bases(config: dict) -> list:
    """作業ディレクトリの候補（優先順）。config の tmp_base_list、無ければ tmp_base の1つ。

    TS 分割の時に先頭から空きを確かめ、足りなければ次を使う。tmp_base は tmp_base_list の
    先頭と同じにしておく（アップロード・副音声の一時ファイル等は tmp_base を使う）。
    """
    lst = [str(x).strip().rstrip('/') for x in ((config or {}).get('tmp_base_list') or []) if str(x).strip()]
    if lst:
        return lst
    tb = ((config or {}).get('tmp_base') or '').strip().rstrip('/')
    return [tb] if tb else []


def known() -> list:
    """覚えている作業フォルダの置き場（tmp_base は含まない）。"""
    try:
        with open(_path(), encoding='utf-8') as f:
            data = json.load(f)
        return [b for b in data if isinstance(b, str) and b]
    except (OSError, ValueError):
        return []


def search_bases(tmp_base: str, extra=()) -> list:
    """作業フォルダを探す置き場。tmp_base・呼び出し側が分かっている場所・覚えている場所の順（重複なし）。"""
    out = []
    for b in [tmp_base, *extra, *known()]:
        b = (b or '').rstrip('/')
        if b and b not in out:
            out.append(b)
    return out


def remember(base: str, tmp_base: str = '') -> None:
    """作業フォルダを置いた場所を覚える。tmp_base と同じなら何もしない。"""
    if not base:
        return
    base = base.rstrip('/')
    if tmp_base and base == tmp_base.rstrip('/'):
        return
    with _lock:
        bases = known()
        if base in bases:
            return
        bases.append(base)
        try:
            os.makedirs(data_paths.DATA_DIR, exist_ok=True)
            tmp = _path() + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(bases, f, ensure_ascii=False, indent=1)
            os.replace(tmp, _path())
            logger.info('作業フォルダの置き場を覚えました: %s', base)
        except OSError as e:
            logger.warning('作業フォルダの置き場を覚えられませんでした: %s: %s', base, e)
