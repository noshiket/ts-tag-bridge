"""視聴履歴"""

import time

from quart import current_app, jsonify, request
from .auth import (  # noqa: F401
    auth_bp,
    current_user,
)
from .watch_rows import _clean_recording_watch_entries, _filter_watch_by_kind, _watch_row_to_client, _drop_private_video_entries


# ── 視聴履歴 ────────────────────────────────────────────────────────────


@auth_bp.get('/api/users/me/watch-history')
async def get_watch_history():
    """自分の視聴履歴（続きを見る）。?kind=video で音楽を除く、audio で音楽だけ。

    録画の行は、動画になっていれば付け替え、無くなっていれば消してから返す。非公開カテゴリの動画は出さない。
    """
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    t0 = time.perf_counter()
    rows = current_app.config['USERS_DB'].get_watch_history(user['id'])
    t1 = time.perf_counter()
    # 録画エントリの移行/掃除を行い、変化があれば整理後の一覧を返す
    remapped, dropped = _clean_recording_watch_entries(user['id'], rows)
    if remapped or dropped:
        rows = current_app.config['USERS_DB'].get_watch_history(user['id'])
    t2 = time.perf_counter()
    # 非公開カテゴリの動画は、プライベートモード以外では返さない。履歴の行自体が
    # 題名・話数名を持つため、カード側(videos/cards)を伏せるだけでは一覧に残ってしまう
    rows = _drop_private_video_entries(rows)
    t3 = time.perf_counter()
    # ?kind=video で音楽を除く / audio で音楽だけ（続きを見る と ミュージックタブの出し分け）。
    # 指定なしは全部（起動時の同期はこちら。落とすと手元から再生位置が消えるため）
    rows = _filter_watch_by_kind(rows, request.args.get('kind'))
    t4 = time.perf_counter()
    # 遅い時だけどこで時間を使ったかを残す（アプリの「応答がありません」の切り分け用）
    if t4 - t0 > 1.0:
        current_app.logger.info('[watch timing] total=%.2fs read=%.2fs clean=%.2fs private=%.2fs kind=%.2fs n=%d',
                                t4 - t0, t1 - t0, t2 - t1, t3 - t2, t4 - t3, len(rows))
    return jsonify([_watch_row_to_client(r) for r in rows])


@auth_bp.get('/api/users/me/watch-history/entry')
async def get_watch_entry():
    """file_key を指定して1件だけ返す（続き再生の位置取得用）。

    一覧は非公開カテゴリの動画を落とすので、そのままでは非公開動画の続き位置が
    手元に来ない（プライベートモードでも起動時の同期で欠ける）。再生しようとしている
    動画そのものを名指しで引く経路なので、ここでは伏せずに返す。
    """
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    key = request.args.get('file_key') or ''
    if not key:
        return jsonify(None)
    rows = current_app.config['USERS_DB'].get_watch_entries(user['id'], [key])
    return jsonify(_watch_row_to_client(rows[0]) if rows else None)


@auth_bp.put('/api/users/me/watch-history')
async def put_watch_history():
    """視聴履歴をまとめて書く。body: {entries: [{fileKey, ...}]}。

    録画の行はその場で付け替え・削除し、件数を remapped・dropped で返す（端末側も合わせるため）。
    """
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    body = await request.get_json() or {}
    entries = body.get('entries', [])
    if not isinstance(entries, list):
        return jsonify({'error': 'entries は配列です'}), 400
    users_db = current_app.config['USERS_DB']
    users_db.upsert_watch_history(user['id'], entries)
    # アップロードされた録画エントリもその場で整理し、結果をクライアントへ返す。
    # クライアントはこれを見てローカルキャッシュ側も付け替え/削除するため、
    # 実体の無い録画エントリが次回同期で再アップロードされて復活しない。
    # get_watch_history() は表示用に件数を絞っているので、ここで使うと古い視聴の
    # エントリが整理対象から漏れる（端末に残った古い動画idが毎回復活する）。キー指定で引く。
    keys = {str(e.get('fileKey') or '') for e in entries if isinstance(e, dict)}
    rows = users_db.get_watch_entries(user['id'], keys)
    remapped, dropped = _clean_recording_watch_entries(user['id'], rows)
    return jsonify({'ok': True, 'count': len(entries), 'remapped': remapped, 'dropped': dropped})


@auth_bp.delete('/api/users/me/watch-history/<path:file_key>')
async def delete_watch_history(file_key):
    """視聴履歴から1件消す（file_key で指定）。"""
    user = current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    current_app.config['USERS_DB'].delete_watch_history_entry(user['id'], file_key)
    return jsonify({'ok': True})
