"""マイリストと視聴履歴"""

from datetime import datetime


class _HistoryMixin:
    """UsersDB の一部（マイリストと視聴履歴）。"""

    def list_mylist(self, user_id: int) -> list:
        """追加が新しい順に album_id を返す。"""
        with self._conn() as c:
            rows = c.execute(
                'SELECT album_id FROM mylist WHERE user_id = ? ORDER BY created_at DESC, album_id DESC',
                (user_id,)).fetchall()
        return [r[0] for r in rows]

    def remap_mylist_album(self, old_album_id: int, new_album_id: int) -> int:
        """マイリストのアルバムidを old→new へ張り替える（フォルダ一括変更で id が変わるため）。
        既に new を持っている利用者は重複するので old 側を消す。戻り値は張り替えた行数。"""
        if old_album_id is None or new_album_id is None or old_album_id == new_album_id:
            return 0
        with self._conn() as c:
            # 接続を使い回すので total_changes は累計になって使えない。この UPDATE の
            # 変更行数を直接取る（旧実装では新規接続直後の total_changes == この文の変更数）。
            cur = c.execute('UPDATE OR IGNORE mylist SET album_id=? WHERE album_id=?',
                            (new_album_id, old_album_id))
            n = cur.rowcount
            c.execute('DELETE FROM mylist WHERE album_id=?', (old_album_id,))
        return n

    def add_mylist(self, user_id: int, album_id: int) -> None:
        with self._conn() as c:
            c.execute('INSERT OR IGNORE INTO mylist (user_id, album_id) VALUES (?, ?)',
                      (user_id, album_id))

    def remove_mylist(self, user_id: int, album_id: int) -> None:
        with self._conn() as c:
            c.execute('DELETE FROM mylist WHERE user_id = ? AND album_id = ?', (user_id, album_id))

    def get_watch_history(self, user_id: int, limit: int = None) -> list:
        with self._conn() as c:
            rows = c.execute(
                'SELECT * FROM watch_history WHERE user_id=? ORDER BY updated_at DESC LIMIT ?',
                (user_id, int(limit or self.WATCH_HISTORY_LIMIT)),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_watch_entries(self, user_id: int, file_keys) -> list:
        """指定 file_key の履歴だけを返す（件数制限なし）。

        get_watch_history() は表示用に直近 WATCH_HISTORY_LIMIT 件しか返さないため、アップロードされた
        エントリの整理（実体の無い動画の貼り替え/削除）にはこちらを使う。古い視聴ほど
        300件から溢れて整理されず、端末に残った古い動画idが延々と復活してしまうため。
        """
        keys = [k for k in (file_keys or []) if k]
        if not keys:
            return []
        out = []
        with self._conn() as c:
            for i in range(0, len(keys), 400):     # SQLite の変数上限を避けて分割
                chunk = keys[i:i + 400]
                marks = ','.join('?' * len(chunk))
                out += [dict(r) for r in c.execute(
                    f'SELECT * FROM watch_history WHERE user_id=? AND file_key IN ({marks})',
                    (user_id, *chunk)).fetchall()]
        return out

    def get_video_watch_map(self, user_id: int) -> dict:
        """アルバムの視聴順ソート用: このユーザーが動画(video.db)を視聴した最終日時を
        video_id単位で返す({video_id: updated_at})。get_watch_history()は表示用に件数を絞っている
        に絞っているが、ここでは古いアルバムの視聴順が欠落しないよう全件を対象にする。"""
        with self._conn() as c:
            rows = c.execute(
                "SELECT last_id, updated_at FROM watch_history WHERE user_id=? AND last_type='video'",
                (user_id,),
            ).fetchall()
        result = {}
        for r in rows:
            try:
                vid = int(r['last_id'])
            except (TypeError, ValueError):
                continue
            result[vid] = r['updated_at']
        return result

    def get_video_watch_state(self, user_id: int) -> dict:
        """アルバムの新着の判定用: 動画(video.db)ごとの {video_id: (updated_at, progress, play_count)}"""
        with self._conn() as c:
            rows = c.execute(
                "SELECT last_id, updated_at, progress, play_count FROM watch_history WHERE user_id=? AND last_type='video'",
                (user_id,),
            ).fetchall()
        result = {}
        for r in rows:
            try:
                result[int(r['last_id'])] = (r['updated_at'], r['progress'], r['play_count'])
            except (TypeError, ValueError):
                continue
        return result

    def upsert_watch_history(self, user_id: int, entries: list):
        with self._conn() as c:
            for e in entries:
                # 再生回数: しきい値を「越えた瞬間」だけ +1 する。毎回の進捗更新で増やすと
                # 数が跳ね上がり、見直し(進捗が戻ってからまた越える)は数えたいので、
                # 保存済みの進捗と突き合わせて判定する。
                row = c.execute('SELECT progress FROM watch_history WHERE user_id=? AND file_key=?',
                                (user_id, e.get('fileKey', ''))).fetchone()
                prev = (row['progress'] if row and row['progress'] is not None else 0) or 0
                now = e.get('progress', 0) or 0
                bump = 1 if (now >= self.WATCH_COMPLETE_RATIO > prev) else 0
                c.execute('''
                    INSERT INTO watch_history
                        (user_id, onid, tsid, sid, eid, eit_start, title, episode_num, episode_name,
                         last_type, last_id, file_key, progress, resume_tot, pos, play_count, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(user_id, file_key) DO UPDATE SET
                        onid=excluded.onid, tsid=excluded.tsid, sid=excluded.sid, eid=excluded.eid,
                        eit_start=excluded.eit_start, title=excluded.title,
                        episode_num=excluded.episode_num, episode_name=excluded.episode_name,
                        last_type=excluded.last_type, last_id=excluded.last_id,
                        progress=excluded.progress, resume_tot=excluded.resume_tot,
                        pos=excluded.pos, updated_at=excluded.updated_at,
                        play_count=watch_history.play_count + ?
                    WHERE excluded.updated_at >= watch_history.updated_at
                ''', (
                    user_id,
                    e.get('onid'), e.get('tsid'), e.get('sid'), e.get('eid'),
                    e.get('eitStart'), e.get('title'),
                    e.get('episodeNum'), e.get('episodeName'),
                    e.get('lastType'), str(e.get('lastId', '')),
                    e.get('fileKey', ''),
                    e.get('progress', 0),
                    e.get('resumeTot'), e.get('pos'), bump,
                    e.get('updatedAt', datetime.utcnow().isoformat()),
                    bump,
                ))

    def remap_watch_entry(self, user_id: int, old_file_key: str, new_type: str, new_id) -> bool:
        """1ユーザーの視聴履歴エントリを別の type/id へ付け替える（進捗・位置は保持）。
        録画(recording)エントリを、エンコード済み video のエントリへ移行するのに使う。
        付け替え先のキーが既にある場合は更新の新しい方を残して古い行を消す。"""
        new_key = f'{new_type}:{new_id}'
        if new_key == old_file_key:
            return False
        with self._conn() as c:
            row = c.execute('SELECT * FROM watch_history WHERE user_id=? AND file_key=?',
                            (user_id, old_file_key)).fetchone()
            if row is None:
                return False
            existing = c.execute('SELECT updated_at FROM watch_history WHERE user_id=? AND file_key=?',
                                 (user_id, new_key)).fetchone()
            if existing is not None:
                # 既に移行先の履歴がある: 新しい方を残し、録画側の行は捨てる
                if (row['updated_at'] or '') > (existing['updated_at'] or ''):
                    c.execute('DELETE FROM watch_history WHERE user_id=? AND file_key=?',
                              (user_id, new_key))
                else:
                    c.execute('DELETE FROM watch_history WHERE user_id=? AND file_key=?',
                              (user_id, old_file_key))
                    return True
            c.execute('UPDATE watch_history SET last_type=?, last_id=?, file_key=? '
                      'WHERE user_id=? AND file_key=?',
                      (new_type, str(new_id), new_key, user_id, old_file_key))
        return True

    def delete_watch_history_entry(self, user_id: int, file_key: str):
        with self._conn() as c:
            c.execute(
                'DELETE FROM watch_history WHERE user_id=? AND file_key=?', (user_id, file_key)
            )

    def remap_video_watch_history(self, old_video_id, new_video_id) -> int:
        """動画id が変わった(relocate / 再エンコードでの差し替え)際、全ユーザーの視聴履歴リンクを
        old→new へ張り替える。file_key='video:old' を 'video:new' に、last_id も new に更新する。
        同一ユーザーが既に 'video:new' を持つ場合は UNIQUE(user_id,file_key) 衝突を避けるため、
        現行(new)を残して古い(old)行を削除する。戻り値は張り替えた行数。"""
        if old_video_id is None or new_video_id is None:
            return 0
        old_key = f'video:{old_video_id}'
        new_key = f'video:{new_video_id}'
        if old_key == new_key:
            return 0
        with self._conn() as c:
            conflict_users = {r[0] for r in c.execute(
                'SELECT user_id FROM watch_history WHERE file_key=?', (new_key,)).fetchall()}
            remapped = 0
            for wid, uid in c.execute(
                    'SELECT id, user_id FROM watch_history WHERE file_key=?', (old_key,)).fetchall():
                if uid in conflict_users:
                    c.execute('DELETE FROM watch_history WHERE id=?', (wid,))  # 既に new があるので old を削除
                else:
                    c.execute('UPDATE watch_history SET last_id=?, file_key=? WHERE id=?',
                              (str(new_video_id), new_key, wid))
                    remapped += 1
            return remapped
