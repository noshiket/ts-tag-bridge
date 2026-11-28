"""アルバム一覧の覚え（作り直しは1つずつ・古い物を出しながら裏で作る）"""

import time
import threading


# アルバム一覧キャッシュ。get_albums 自体は軽い(約65ms)が、スキャン/エンコードの
# CPU 競合で「たまに遅い」ため短期 TTL でキャッシュし、書き込み(非GET)後は無効化する。
# エンコードの実行のエンコード完了は routes を介さず video.db を直接更新するため TTL で取り込む。
# 非公開カテゴリの組み合わせごとに分ける（キー: カテゴリ名のタプル）
_albums_cache = {}


_albums_cache_lock = threading.Lock()


_albums_build_lock = threading.Lock()


# 最後に作った一覧（video.db の変化で箱が外れても、作り直しの間はこれを返す）と、裏で作り直している箱
_albums_last = {}


_albums_rebuilding = set()


# アルバム一覧は生成が重い(実測 0.3〜1.5s)ので長めに持つ。API 経由の書き込みは
# after_request で消し、ワーカー等 API を通らない変更は PRAGMA data_version を
# キーに混ぜて拾うので、古いまま出続けることはない
_ALBUMS_CACHE_TTL = 300.0  # seconds


def _invalidate_albums_cache():
    # API の書き込みの後は古い一覧を返さない（作り直しを待つ）
    with _albums_cache_lock:
        _albums_cache.clear()
        _albums_last.clear()


def _get_albums_cached(db, dir_roots=None, private_categories=None, media_kind=None) -> list:
    """アルバム一覧を 30秒 TTL でキャッシュして返す。書き込み後は after_request で無効化。
    db / dir_roots は起動時ウォームアップ（app context 外）から明示渡しするための引数。

    非公開カテゴリは利用者ごとに違うので、キャッシュはその内容ごとに分ける
    （1つの箱に入れると、隠すはずの利用者に他人のキャッシュを返してしまう）。
    音楽/動画の絞り込みも別の箱にする。"""
    key = (media_kind, tuple(sorted(private_categories or ())), db.data_version())

    def _hit():
        with _albums_cache_lock:
            got = _albums_cache.get(key)
            if got is not None and time.time() - got['ts'] < _ALBUMS_CACHE_TTL:
                return got['data']
        return None

    data = _hit()
    if data is not None:
        return data
    last_key = (media_kind, tuple(sorted(private_categories or ())))

    def _build():
        data = db.get_albums(dir_roots, private_categories=private_categories, media_kind=media_kind)
        with _albums_cache_lock:
            _albums_cache[key] = {'ts': time.time(), 'data': data}
            _albums_last[last_key] = data
        return data

    # video.db が変わって（録画・エンコードの登録など。API を通らない書き込み）箱が外れた時は、前の一覧を
    # すぐ返して裏で作り直す（作り直しは数秒かかり、その間アプリが「応答がありません」になったため）
    with _albums_cache_lock:
        stale = _albums_last.get(last_key)
        start = stale is not None and last_key not in _albums_rebuilding
        if start:
            _albums_rebuilding.add(last_key)
    if stale is not None:
        if start:
            def _bg():
                try:
                    with _albums_build_lock:
                        _build()
                except Exception:
                    pass
                finally:
                    with _albums_cache_lock:
                        _albums_rebuilding.discard(last_key)
            threading.Thread(target=_bg, name='AlbumsRebuild', daemon=True).start()
        return stale
    # 前の一覧も無い時（起動直後・API の書き込みの後）は作る。作るのは同時に1つだけ。起動直後など空の時に
    # 同時に来た要求がそれぞれ作ると（1回 7秒ほど）全部が遅れた。後の要求は先の結果を使う
    with _albums_build_lock:
        data = _hit()
        if data is not None:
            return data
        return _build()
