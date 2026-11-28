"""自動エンコードのルール"""

from datetime import datetime
from typing import Optional, List


class _AutoEncodeMixin:
    """ProgramDB の一部（自動エンコードのルール）。"""

    def add_auto_encode(self, **fields) -> int:
        now = datetime.now().isoformat()
        data = {k: fields[k] for k in self._AUTO_ENCODE_FIELDS if k in fields}
        data['created_at'] = now
        data['updated_at'] = now
        cols = ', '.join(data.keys())
        ph = ', '.join('?' * len(data))
        conn = self._get_conn()
        cur = conn.execute(f"INSERT INTO auto_encode ({cols}) VALUES ({ph})", tuple(data.values()))
        conn.commit()
        return cur.lastrowid

    def list_auto_encode(self, enabled_only: bool = False) -> List[dict]:
        sql = "SELECT * FROM auto_encode"
        if enabled_only:
            sql += " WHERE enabled = 1"
        sql += " ORDER BY id DESC"
        return [dict(r) for r in self._get_conn().execute(sql).fetchall()]

    def get_auto_encode(self, ae_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM auto_encode WHERE id = ?", (ae_id,)).fetchone()
        return dict(row) if row else None

    def update_auto_encode(self, ae_id: int, **fields):
        fields = {k: v for k, v in fields.items() if k in self._AUTO_ENCODE_FIELDS}
        if not fields:
            return
        fields['updated_at'] = datetime.now().isoformat()
        set_clause = ', '.join(f"{k} = ?" for k in fields)
        conn = self._get_conn()
        conn.execute(f"UPDATE auto_encode SET {set_clause} WHERE id = ?",
                     list(fields.values()) + [ae_id])
        conn.commit()

    def delete_auto_encode(self, ae_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM auto_encode WHERE id = ?", (ae_id,))
        conn.commit()
