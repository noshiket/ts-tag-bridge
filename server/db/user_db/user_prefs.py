"""利用者の好み・入力の履歴・見られる範囲（権限）"""

import json
from datetime import datetime


class _UserPrefsMixin:
    """利用者の好み・入力の履歴・見られる範囲（権限）"""

    def get_prefs(self, user_id: int) -> dict:
        with self._conn() as c:
            row = c.execute('SELECT * FROM user_prefs WHERE user_id=?', (user_id,)).fetchone()
        if not row:
            return {'user_id': user_id, 'tweaks': {}, 'channel_filter': [],
                    'time_filter': {}, 'private_categories': []}
        d = dict(row)
        for k, default in (('tweaks', '{}'), ('channel_filter', '[]'), ('time_filter', '{}'),
                           ('private_categories', '[]')):
            try:
                d[k] = json.loads(d[k] or default)
            except Exception:
                d[k] = json.loads(default)
        return d

    def get_input_history(self, user_id: int) -> dict:
        """欄ごとの履歴 {欄: [新しい順]}。"""
        with self._conn() as c:
            rows = c.execute('SELECT hkey, items FROM input_history WHERE user_id=?', (user_id,)).fetchall()
        out = {}
        for r in rows:
            try:
                v = json.loads(r['items'] or '[]')
            except Exception:
                v = []
            out[r['hkey']] = [x for x in v if isinstance(x, str)] if isinstance(v, list) else []
        return out

    def change_input_history(self, user_id: int, key: str, push: str | None = None,
                             remove: str | None = None, merge: list | None = None) -> list:
        """1つの欄の履歴を変えて、変えた後の一覧を返す。読み書きを1つの処理で行い、
        別の端末から同時に足しても消し合わない。
        push: 先頭へ足す / remove: 消す / merge: 端末に残っていた分を後ろへ足す（サーバーの分を優先）"""
        c = self._conn()
        with c:
            c.execute('BEGIN IMMEDIATE')
            r = c.execute('SELECT items FROM input_history WHERE user_id=? AND hkey=?', (user_id, key)).fetchone()
            try:
                cur = json.loads(r['items']) if r else []
            except Exception:
                cur = []
            cur = [x for x in cur if isinstance(x, str)] if isinstance(cur, list) else []
            for v in merge or []:
                s = v.strip() if isinstance(v, str) else ''
                if len(s) >= self.INPUT_HISTORY_MIN_LEN and s not in cur:
                    cur.append(s)
            if remove is not None:
                cur = [x for x in cur if x != remove]
            if isinstance(push, str):
                s = push.strip()
                if len(s) >= self.INPUT_HISTORY_MIN_LEN:
                    cur = [s] + [x for x in cur if x != s]
            cur = cur[:self.INPUT_HISTORY_MAX]
            c.execute('INSERT INTO input_history (user_id, hkey, items, updated_at) VALUES (?,?,?,?) '
                      'ON CONFLICT(user_id, hkey) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at',
                      (user_id, key, json.dumps(cur, ensure_ascii=False), datetime.utcnow().isoformat()))
        return cur

    def get_perms(self, user_id: int) -> dict:
        with self._conn() as c:
            row = c.execute('SELECT * FROM user_perms WHERE user_id=?', (user_id,)).fetchone()
        if not row:
            return {'user_id': user_id, **self.PERM_DEFAULT}
        d = dict(row)
        for k in self._PERM_LISTS:
            try:
                d[k] = json.loads(d[k] or '[]')
            except Exception:
                d[k] = []
        d['can_write'] = int(d.get('can_write') or 0)
        d['paid'] = int(d.get('paid') or 0)
        return d

    def update_perms(self, user_id: int, **kwargs):
        fields = {k: v for k, v in kwargs.items() if k in self.PERM_DEFAULT}
        if not fields:
            return self.get_perms(user_id)
        pairs = [(k, int(bool(v)) if k in ('can_write', 'paid') else json.dumps(v, ensure_ascii=False))
                 for k, v in fields.items()]
        sets = ', '.join(f'{k}=?' for k, _ in pairs)
        with self._conn() as c:
            # 承認より前に作られた行が無いことがあるので、無ければ作ってから更新する
            c.execute('INSERT OR IGNORE INTO user_perms (user_id) VALUES (?)', (user_id,))
            c.execute(f'UPDATE user_perms SET {sets}, updated_at=? WHERE user_id=?',
                      [v for _, v in pairs] + [datetime.utcnow().isoformat(), user_id])
        return self.get_perms(user_id)

    def update_prefs(self, user_id: int, **kwargs):
        allowed = {'tweaks', 'channel_filter', 'time_filter', 'allowed_hours',
                   'private_categories'}
        fields = {k: v for k, v in kwargs.items() if k in allowed}
        if not fields:
            return
        pairs = [(k, json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v)
                 for k, v in fields.items()]
        sets = ', '.join(f'{k}=?' for k, _ in pairs)
        vals = [v for _, v in pairs]
        vals.append(datetime.utcnow().isoformat())
        vals.append(user_id)
        with self._conn() as c:
            c.execute(f'UPDATE user_prefs SET {sets}, updated_at=? WHERE user_id=?', vals)
