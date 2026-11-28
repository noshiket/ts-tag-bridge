"""録画の送り出しの続きと送り直し（途中で止まった・失敗した分）"""

import json
from ..common import logger
from .transfer import transfer_recording_to_node


# 送り直す対象の phase。
#   starting/waiting/sending/finalizing: 転送はデーモンスレッドなのでプロセスと一緒に
#     死ぬ。起動直後にこれが残っていれば必ず前回の中断で、進行中ということはあり得ない。
#   interrupted: 相手が落ちた・回線が切れた。中身の問題ではないので送り直せば直る。
# 'error'(中身の問題) と 'done'/'already' は対象にしない。
_TRANSFER_INFLIGHT_PHASES = frozenset({'starting', 'waiting', 'sending', 'finalizing',
                                       'interrupted'})


def resume_interrupted_transfers(db, config: dict) -> int:
    """再起動で中断したノードへの録画転送を送り直す。起動時に呼ぶ。

    転送は数GBを数分〜数十分かけて送るデーモンスレッドで、サーバーを再起動すると
    途中で死ぬ。transfer_state は 'sending' のまま残るが誰も再開しないので、録画は
    waiting のまま永久に何も起きない（実測: 19GB中1.5GBで止まったまま）。

    受け側は transfer_id が同じなら上書きするので、頭から送り直してよい。
    戻り値は送り直した件数。
    """
    import threading

    resumed = 0
    for rec in (db.list_recordings() or []):
        raw = rec.get('transfer_state')
        if not raw:
            continue
        try:
            st = json.loads(raw) if isinstance(raw, str) else raw
        except (ValueError, TypeError):
            continue
        if not isinstance(st, dict) or st.get('phase') not in _TRANSFER_INFLIGHT_PHASES:
            continue
        node_name = st.get('node')
        if not node_name:
            continue
        rec_id = rec['id']
        sent, total = st.get('sent') or 0, st.get('total') or 0
        logger.info('resume_interrupted_transfers: rec=%d → %s の転送が %s のまま'
                    '中断している(%.1f/%.1f GB)ので送り直します',
                    rec_id, node_name, st.get('phase'),
                    sent / 1024 ** 3, total / 1024 ** 3)
        priority = st.get('priority')
        priority = priority if isinstance(priority, int) else 3

        def _resend(rid=rec_id, node=node_name, prio=priority):
            try:
                transfer_recording_to_node(db, rid, config, node, prio)
            except Exception as e:
                logger.error('resume_interrupted_transfers: rec=%d の送り直しに失敗: %s',
                             rid, e)

        threading.Thread(target=_resend, daemon=True).start()
        resumed += 1
    return resumed


# 転送の送り直しを繰り返す間隔と、諦めるまでの回数。
# 起動時の1回きりだと、相手が立ち上がりきる前に当たって終わってしまう。
# 実測: こちらの再開は 17:22:18、相手のサーバーが起きたのは 17:22:25 で、
# 7秒差で「Connection refused」になりそのまま放置された（20GB が2件）。
_RETRY_EVERY_SEC = 600


_RETRY_MAX = 12                    # 600秒 × 12 = 2時間ぶん粘る


_RETRY_PHASES = frozenset({'interrupted', 'error'})


# 送り直しの回数と時刻。transfer_state へ書くと、送り直しそのものが
# transfer_state を上書きするので毎回 0 に戻り、延々と再送し続ける
# （実測: 10分おきに「1回目」を繰り返していた）。
_retry_book = {}                   # rec_id -> [回数, 最後に試した時刻]


def retry_failed_transfers(db, config: dict) -> int:
    """切れた／失敗した録画転送を送り直す。定期的に呼ぶ。

    相手を再起動すると転送は必ず切れる。phase='interrupted'（切れた）と
    phase='error'（finalize で失敗した等）を拾い、間隔をあけて送り直す。
    起動時の resume_interrupted_transfers と違い、相手が落ちていても
    次の回で拾えるのが要点。

    同じノードへ同時に走らせない（回線とディスクを食い合う）。順番は
    「最後に試したのが古い順」。そうしないと、必ず失敗する1件が毎回枠を
    取ってしまい、他が一生回ってこない（実測: 失敗し続ける1件が、ほかの2件を
    塞いでいた）。
    """
    import threading
    import time as _time

    now = _time.time()
    busy = set()
    cands = []
    for rec in (db.list_recordings() or []):
        raw = rec.get('transfer_state')
        if not raw:
            continue
        try:
            st = json.loads(raw) if isinstance(raw, str) else raw
        except (ValueError, TypeError):
            continue
        if not isinstance(st, dict):
            continue
        node_name = st.get('node')
        if not node_name:
            continue
        phase = st.get('phase')
        # interrupted は _TRANSFER_INFLIGHT_PHASES にも入っているが、実際には
        # 走っていない（起動時の再開が拾えるようにそちらへ入れてある）。
        # 先に送り直しの対象かを見ないと、自分自身を「走っている」と数えてしまう
        if phase in _RETRY_PHASES:
            cands.append((rec['id'], node_name, st))
            continue
        if phase in _TRANSFER_INFLIGHT_PHASES:
            busy.add(node_name)          # まだ走っているノードには足さない
            continue

    cands.sort(key=lambda c: _retry_book.get(c[0], [0, 0.0])[1])   # 古い順
    started = 0
    for rec_id, node_name, st in cands:
        if node_name in busy:
            continue
        tries, last = _retry_book.get(rec_id, [0, 0.0])
        if tries >= _RETRY_MAX:
            continue
        if last and now - last < _RETRY_EVERY_SEC:
            continue
        busy.add(node_name)              # 1ノード1本ずつ
        _retry_book[rec_id] = [tries + 1, now]
        priority = st.get('priority')
        priority = priority if isinstance(priority, int) else 3
        logger.info('retry_failed_transfers: rec=%d → %s を送り直します (%d回目)',
                    rec_id, node_name, tries + 1)

        def _resend(rid=rec_id, node=node_name, prio=priority):
            try:
                transfer_recording_to_node(db, rid, config, node, prio)
            except Exception as e:
                logger.warning('retry_failed_transfers: rec=%d の送り直しに失敗: %s', rid, e)

        threading.Thread(target=_resend, daemon=True).start()
        started += 1
    return started
