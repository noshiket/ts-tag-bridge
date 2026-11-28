"""視聴履歴の行の整え方（消えた動画・非公開・種類で絞る）"""

from quart import current_app


def _existing_video_ids(video_db, rows: list) -> set:
    """視聴履歴の動画エントリが指す id のうち、videos に今もあるもの（id だけをまとめて引く）。"""
    if video_db is None:
        return set()
    ids = []
    for r in rows:
        if r.get('last_type') != 'video':
            continue
        try:
            ids.append(int(str(r.get('last_id') or '')))
        except ValueError:
            continue
    found: set = set()
    conn = video_db._get_conn()
    for i in range(0, len(ids), 500):   # SQLite の変数の上限より小さく区切る
        chunk = ids[i:i + 500]
        q = f"SELECT id FROM videos WHERE id IN ({','.join('?' * len(chunk))})"
        found.update(row[0] for row in conn.execute(q, chunk))
    return found


def _clean_recording_watch_entries(user_id: int, rows: list) -> tuple:
    """視聴履歴のエントリを整理する（実体の無い履歴を続きを見るに残さない）。

    録画(recording)エントリ:
    - 対応するエンコード動画が既にあれば video エントリへ付け替える（進捗・位置は保持）
    - recordings に存在しない録画のエントリは削除する
    動画(video)エントリ:
    - id の動画が消えていたら、同じ番組の現行動画へ付け替える（relocate や再エンコードの
      差し替えで id が変わると、端末に残った古い id を指したままリンクが切れるため）
    - 同じ番組の動画も無ければ削除する
    戻り値: (remapped:[{from,to}], dropped:[file_key])
    """
    from api.video_routes.media import resolve_video_id_for_program

    users_db = current_app.config['USERS_DB']
    video_db = current_app.config.get('VIDEO_DB')
    rule_db = current_app.config.get('RULE_DB')
    remapped, dropped = [], []
    # 動画が今もあるかは、まとめて id だけ引く。1件ずつ全列（SELECT *）を引いていた頃は、履歴が千件ほどあると
    # 起動直後に15秒ほどかかり、その間ほかの要求も止まってアプリに「応答がありません」が出た
    existing = _existing_video_ids(video_db, rows)
    for r in rows:
        key = r.get('file_key') or ''
        if not key:
            continue
        # video エントリ: relocate(確定値の反映で移動)や再エンコードの差し替えで video id が
        # 変わると、端末に残った古い id を指したままリンクが切れる。同じ番組の現行 video へ
        # 付け替え、見つからなければ削除する（録画エントリと同じ扱い）。
        if r.get('last_type') == 'video':
            vid_raw = str(r.get('last_id') or '')
            if not vid_raw or ':' in vid_raw or video_db is None:
                continue          # federation の 'node:id' はこのサーバーの管轄外
            try:
                vid_i = int(vid_raw)
            except ValueError:
                continue
            if vid_i in existing:
                continue          # 実体あり
            new_vid = resolve_video_id_for_program(video_db, r.get('onid'), r.get('tsid'),
                                                   r.get('sid'), r.get('eid'),
                                                   r.get('eit_start'), r.get('resume_tot'))
            if new_vid is not None and new_vid != vid_i:
                if users_db.remap_watch_entry(user_id, key, 'video', new_vid):
                    remapped.append({'from': key, 'to': f'video:{new_vid}'})
            elif new_vid is None:
                users_db.delete_watch_history_entry(user_id, key)
                dropped.append(key)
            continue
        if r.get('last_type') != 'recording':
            continue
        vid = resolve_video_id_for_program(video_db, r.get('onid'), r.get('tsid'), r.get('sid'),
                                           r.get('eid'), r.get('eit_start'), r.get('resume_tot'))
        if vid is not None:
            if users_db.remap_watch_entry(user_id, key, 'video', vid):
                remapped.append({'from': key, 'to': f'video:{vid}'})
            continue
        # federation の 'node:id' 形式はこのサーバーの recordings に無くて当然なので触らない
        rid = str(r.get('last_id') or '')
        if not rid or ':' in rid or rule_db is None:
            continue
        try:
            rid_i = int(rid)
        except ValueError:
            continue
        if rule_db.get_recording(rid_i) is None:
            users_db.delete_watch_history_entry(user_id, key)
            dropped.append(key)
    return remapped, dropped


def _filter_watch_by_kind(rows: list, kind: str) -> list:
    """視聴履歴を動画/音楽で絞る（kind='video'|'audio'。それ以外は素通し）。"""
    if kind not in ('video', 'audio'):
        return rows
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return rows if kind == 'video' else []
    audio_ids = {r['id'] for r in db._get_conn().execute(
        "SELECT id FROM videos WHERE media_kind='audio'")}

    def _is_audio(r):
        if r['last_type'] != 'video':
            return False
        try:
            return int(r['last_id']) in audio_ids
        except (TypeError, ValueError):
            return False
    return [r for r in rows if _is_audio(r) == (kind == 'audio')]


def _watch_row_to_client(r: dict) -> dict:
    """視聴履歴の DB 行(snake_case) → クライアントの形(camelCase)。"""
    return {
        'onid': r['onid'], 'tsid': r['tsid'], 'sid': r['sid'], 'eid': r['eid'],
        'eitStart': r['eit_start'], 'title': r['title'],
        'episodeNum': r['episode_num'], 'episodeName': r['episode_name'],
        'lastType': r['last_type'], 'lastId': r['last_id'],
        'fileKey': r['file_key'],
        'progress': r['progress'], 'resumeTot': r['resume_tot'], 'pos': r['pos'],
        'playCount': r['play_count'] if 'play_count' in r.keys() else 0,
        'updatedAt': r['updated_at'],
    }


def _drop_private_video_entries(rows: list) -> list:
    """視聴履歴から、非公開カテゴリの動画エントリを落とす。

    プライベートモード(?private=1)や非公開指定なしの場合は private_cats() が空を返すので
    そのまま通る。録画(recording)エントリは video.db の管理外なので触らない。
    """
    from api.routes.auth import private_cats

    db = current_app.config.get('VIDEO_DB')
    priv = private_cats()
    if db is None or not priv:
        return rows
    hidden = set(db.private_video_ids(priv))
    if not hidden:
        return rows

    def _keep(r):
        if r['last_type'] != 'video':
            return True
        try:
            return int(r['last_id']) not in hidden
        except (TypeError, ValueError):
            return True
    return [r for r in rows if _keep(r)]
