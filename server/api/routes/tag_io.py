"""tag.json の読み書き（ロック・書き込み中の取り違えの防止）"""

import contextvars
import copy
import logging
import os
import threading
from quart import (
    current_app,
)
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む


# tag.json は「読んで直して書き戻す」形で何本もの口から触られる
# （reparse / confirmed / relocate / 音声比較の取り込み / アドオン …）。
# 字幕を抱えるので 1.5MB を超えることがあり、書いている時間が長い。
#
# ある動画で壊れた。04:30:41 の reparse と 04:30:43 の
# confirmed が重なり、短い方が長い方の上に書かれて末尾39バイトが残り、
# 「正しい JSON + ゴミ」になった。以後 relocate が 404 を返し続けた
# （_load_tag が None を返すため、画面には「tag.json が見つかりません」と出て
#   実際は壊れているのに「消えた」ように見えた）。
#
# 対策は2つとも要る:
#   1. 書き込みをアトミックにする（tmp へ書いて os.replace）。
#      これで「半端なファイル」は原理的に無くなる。
#   2. 同じ tag は1つずつ触る。1 だけでは、先に読んだ側が後から書いて
#      相手の更新を消す（今回それも起きている）。
logger = logging.getLogger('api.routes')   # 分ける前と同じ名前で出す

_tag_locks = {}
_tag_locks_guard = threading.Lock()
# 「この呼び出しが読んだ時の中身」を覚えておく場所。書き戻す時に、読んでから
# 誰かが書いていないかを見るために使う。contextvars なので asyncio のタスク
# ごと・スレッドごとに別々になる（同じ口へ同時に来ても混ざらない）。
_tag_seen = contextvars.ContextVar('tag_seen', default=None)


def _tag_remember(tag_path, tag):
    seen = _tag_seen.get()
    if seen is None:
        seen = {}
        _tag_seen.set(seen)
    seen[os.path.abspath(tag_path)] = copy.deepcopy(tag)


def _tag_merge_onto_current(tag_path, tag):
    """読んでから誰かが書いていたら、自分が変えた項目だけを今の中身へ載せる。

    書き込みをアトミックにしても、読んでから書くまでの間に相手が書けば
    その更新は消える（実際 reparse と confirmed が重なった）。全部を上書き
    せず、**自分が触った項目だけ**を today の中身へ適用すれば、両方残る。
    """
    import json as _j
    before = (_tag_seen.get() or {}).get(os.path.abspath(tag_path))
    if before is None:
        return tag                      # 読まずに書く口（新規作成など）はそのまま
    try:
        with open(tag_path, encoding='utf-8') as f:
            current = _j.load(f)
    except (OSError, _j.JSONDecodeError, UnicodeDecodeError):
        return tag                      # 今の中身が読めないなら自分のを書く
    if current == before:
        return tag                      # 誰も触っていない
    changed = [k for k in tag if k not in before or tag[k] != before[k]]
    removed = [k for k in before if k not in tag]
    merged = dict(current)
    for k in changed:
        merged[k] = tag[k]
    for k in removed:
        merged.pop(k, None)
    logger.info('tag.json: 読んだ後に他が書いたので自分の変更だけ載せます '
                '(%s / 変更 %s / 削除 %s)', os.path.basename(tag_path), changed, removed)
    return merged


def _tag_lock(tag_path):
    """その tag.json 専用の錠。パスごとに1つ。"""
    key = os.path.abspath(tag_path)
    with _tag_locks_guard:
        lk = _tag_locks.get(key)
        if lk is None:
            lk = _tag_locks[key] = threading.RLock()
        return lk


def _load_tag(tag_path):
    """tag.json を読む。無い/壊れているなら None。

    壊れている時は握り潰さず記録する。黙って None を返すと、呼び出し側の
    「tag.json が見つかりません」だけが表に出て原因が追えない。
    """
    import json as _j
    try:
        with _tag_lock(tag_path):
            with open(tag_path, encoding='utf-8') as f:
                tag = _j.load(f)
        _tag_remember(tag_path, tag)
        return tag
    except FileNotFoundError:
        return None
    except (_j.JSONDecodeError, UnicodeDecodeError) as e:
        logger.error('tag.json が壊れています: %s / %s', tag_path, e)
        return None
    except Exception as e:
        logger.warning('tag.json を読めません: %s / %s', tag_path, e)
        return None


def _save_tag(tag_path, tag):
    """tag.json を書く。同じファイルへ同時に書いても壊れない。

    同じディレクトリの tmp へ書いてから os.replace で差し替える
    （別ファイルシステムだと replace が失敗するため同じ場所に置く）。
    """
    import json as _j
    lk = _tag_lock(tag_path)
    with lk:
        tag = _tag_merge_onto_current(tag_path, tag)
        tmp = f'{tag_path}.{os.getpid()}.{threading.get_ident()}.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                _j.dump(tag, f, ensure_ascii=False, indent=2, default=str)
                f.flush()
                os.fsync(f.fileno())     # 電源断で中身が空になるのを防ぐ
            os.replace(tmp, tag_path)
            _tag_remember(tag_path, tag)   # 次に書く時の基準を今の中身へ
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def _remap_watch_history_video(old_video_id, new_video_id):
    """relocate/差し替えで動画idが変わった際、全ユーザーの視聴履歴リンクを old→new へ張り替える。
    失敗しても本処理は止めない（視聴履歴は補助データのため）。"""
    if not new_video_id or old_video_id == new_video_id:
        return
    users_db = current_app.config.get('USERS_DB')
    if users_db is None:
        return
    try:
        users_db.remap_video_watch_history(old_video_id, new_video_id)
    except Exception as e:
        logger.warning('視聴履歴の付け替えに失敗 video %s → %s: %s', old_video_id, new_video_id, e)
