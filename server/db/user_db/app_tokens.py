"""端末用の鍵（アプリのログイン）"""

import secrets
from .common import _token_hash


class _AppTokensMixin:
    """端末用の鍵（アプリのログイン）"""

    def create_app_token(self, user_id: int, name: str) -> str:
        """発行して生のトークンを返す。呼び出し側が受け取れるのはこの1回だけ。"""
        token = secrets.token_urlsafe(32)
        with self._conn() as c:
            c.execute('INSERT INTO app_tokens (user_id, token_hash, name) VALUES (?,?,?)',
                      (user_id, _token_hash(token), name))
        return token

    def list_app_tokens(self, user_id: int) -> list:
        with self._conn() as c:
            rows = c.execute('SELECT id, name, created_at FROM app_tokens '
                             'WHERE user_id=? AND revoked_at IS NULL ORDER BY id',
                             (user_id,)).fetchall()
        return [dict(r) for r in rows]

    def revoke_app_token(self, user_id: int, token_id: int) -> bool:
        """自分のトークンだけ失効できる。既に失効済みなら False。"""
        with self._conn() as c:
            cur = c.execute("UPDATE app_tokens SET revoked_at=datetime('now') "
                            'WHERE id=? AND user_id=? AND revoked_at IS NULL',
                            (token_id, user_id))
            return cur.rowcount > 0

    def user_id_for_app_token(self, token: str):
        """長期トークンから利用者を引く。不明・失効済みは None。"""
        if not token:
            return None
        with self._conn() as c:
            row = c.execute('SELECT user_id FROM app_tokens '
                            'WHERE token_hash=? AND revoked_at IS NULL',
                            (_token_hash(token),)).fetchone()
        return row['user_id'] if row else None
