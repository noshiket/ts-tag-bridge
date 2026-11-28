"""利用者・トークン・設定・権限"""

import json
from .app_tokens import _AppTokensMixin
from .user_prefs import _UserPrefsMixin


class _UsersMixin(_AppTokensMixin, _UserPrefsMixin):
    """UsersDB の一部（利用者・トークン・設定・権限）。"""

    def count_users(self) -> int:
        with self._conn() as c:
            return c.execute('SELECT COUNT(*) FROM users').fetchone()[0]

    def create_user(self, username: str, password: str, is_admin: bool = False,
                    status: str = 'approved') -> int:
        import bcrypt
        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        with self._conn() as c:
            cur = c.execute(
                'INSERT INTO users (username, password_hash, is_admin, status) VALUES (?,?,?,?)',
                (username, pw_hash, 1 if is_admin else 0, status),
            )
            user_id = cur.lastrowid
            c.execute('INSERT INTO user_prefs (user_id) VALUES (?)', (user_id,))
            # 管理者は全許可、それ以外は全部不許可で作る（管理者が付与するまで何も見えない）
            all_ = json.dumps(['*'])
            c.execute('INSERT INTO user_perms (user_id, screens, nodes, stations, can_write) '
                      'VALUES (?,?,?,?,?)',
                      (user_id, all_, all_, all_, 1) if is_admin else (user_id, '[]', '[]', '[]', 0))
            return user_id

    # ── ネイティブアプリの長期トークン ──────────────────────────


    def verify_user(self, username: str, password: str):
        import bcrypt
        with self._conn() as c:
            row = c.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        if not row:
            return None
        if bcrypt.checkpw(password.encode(), row['password_hash'].encode()):
            return {'id': row['id'], 'username': row['username'], 'is_admin': row['is_admin'],
                    'status': (row['status'] if 'status' in row.keys() else 'approved') or 'approved'}
        return None

    def get_user(self, user_id: int):
        with self._conn() as c:
            row = c.execute(
                'SELECT id, username, is_admin, status, created_at FROM users WHERE id=?', (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_user_by_username(self, username: str):
        with self._conn() as c:
            row = c.execute(
                'SELECT id, username, is_admin, status, created_at FROM users WHERE username=?', (username,)
            ).fetchone()
        return dict(row) if row else None

    def list_users(self):
        with self._conn() as c:
            rows = c.execute(
                'SELECT id, username, is_admin, status, created_at FROM users ORDER BY id'
            ).fetchall()
        return [dict(r) for r in rows]

    def set_user_status(self, user_id: int, status: str) -> bool:
        """承認状態を変える（'approved' / 'rejected' / 'pending'）。"""
        if status not in ('approved', 'rejected', 'pending'):
            raise ValueError(f'不正な状態: {status}')
        with self._conn() as c:
            cur = c.execute('UPDATE users SET status=? WHERE id=?', (status, user_id))
            return cur.rowcount > 0

    def set_admin(self, user_id: int, is_admin: bool) -> bool:
        """管理者にする・外す。"""
        with self._conn() as c:
            cur = c.execute('UPDATE users SET is_admin=? WHERE id=?', (1 if is_admin else 0, user_id))
            return cur.rowcount > 0

    def delete_user(self, user_id: int):
        with self._conn() as c:
            c.execute('DELETE FROM users WHERE id=?', (user_id,))

    # ── user_prefs ─────────────────────────────────────────────────────


    # ── 入力欄の履歴 ────────────────────────────────────────────────────
    # 決め方はアプリの packages/core/src/util/inputHistory.ts と同じ（新しい順・重ねない・短いものは残さない）
    INPUT_HISTORY_MAX = 20
    INPUT_HISTORY_MIN_LEN = 2


