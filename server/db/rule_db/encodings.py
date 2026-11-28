"""外部ディスク・アドオンのジョブ・エンコード（encodings）"""

from datetime import datetime
from typing import Optional, List
from .common import (  # noqa: F401
    _emit,
)


class _EncodingsMixin:
    """ProgramDB の一部（外部ディスク・アドオンのジョブ・エンコード（encodings））。"""

    def upsert_disk(self, mount_point: str, disk_id: Optional[str], is_external: int):
        """ディスクレジストリを upsert する。"""
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO disks (mount_point, disk_id, is_external, updated_at)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(mount_point) DO UPDATE SET"
            "   disk_id=excluded.disk_id, is_external=excluded.is_external,"
            "   updated_at=excluded.updated_at",
            (mount_point, disk_id, int(is_external), datetime.now().isoformat()))
        conn.commit()

    def list_disks(self) -> List[dict]:
        return [dict(r) for r in self._get_conn().execute("SELECT * FROM disks").fetchall()]

    def disk_offline(self, path: str) -> bool:
        """path が登録済み外部ディスク配下で、かつそのディスクが取り外されている
        （マウント点直下のマーカー消失 / ID 不一致）なら True を返す。
        内蔵・未登録・オンラインは False。"""
        import os
        if not path:
            return False
        real = os.path.realpath(path)
        best = None
        for d in self.list_disks():
            if not d.get('is_external'):
                continue
            mp = d['mount_point']
            if real == mp or real.startswith(mp.rstrip('/') + '/'):
                if best is None or len(mp) > len(best['mount_point']):
                    best = d
        if best is None:
            return False  # 内蔵 or 未登録 → オフライン扱いしない
        marker = os.path.join(best['mount_point'], self.DISK_MARKER)
        if not os.path.exists(marker):
            return True   # 外部ディスクだがマーカーなし → 取り外し中
        expected = best.get('disk_id')
        if expected:
            try:
                with open(marker, encoding='utf-8') as f:
                    return f.read().strip() != expected  # 別ディスクがマウントされている
            except OSError:
                return False
        return False

    # ------------------------------------------------------------------
    # encodings
    # ------------------------------------------------------------------

    def find_pending_video_addon(self, addon_name: str, video_id: int):
        """同じアドオン×同じ動画で、まだ終わっていない行。二重に積まないため。"""
        row = self._get_conn().execute(
            "SELECT * FROM encodings WHERE job_kind='video_addon' "
            "AND addon_name=? AND video_id=? "
            "AND state NOT IN ('encode_end','encode_error') LIMIT 1",
            (addon_name, video_id)).fetchone()
        return dict(row) if row else None

    def list_video_addon_jobs(self, limit: int = 50):
        """エンコードキュー画面に並べるための一覧（新しい順）。"""
        rows = self._get_conn().execute(
            "SELECT id, state, progress, priority, addon_name, video_id, title, folder, "
            "error_message, created_at, updated_at FROM encodings "
            "WHERE job_kind='video_addon' ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def add_encoding(self, recording_id: int, **fields) -> int:
        now = datetime.now().isoformat()
        fields.setdefault('order_index', 0)
        fields.setdefault('state', 'wait_encode')
        fields['created_at'] = now
        fields['updated_at'] = now
        cols = ', '.join(['recording_id'] + list(fields.keys()))
        placeholders = ', '.join('?' * (1 + len(fields)))
        vals = [recording_id] + list(fields.values())
        conn = self._get_conn()
        cursor = conn.execute(
            f'INSERT INTO encodings ({cols}) VALUES ({placeholders})',
            vals
        )
        conn.commit()
        _emit('encoding.queued', {'encoding_id': cursor.lastrowid,
                                  'recording_id': recording_id,
                                  'state': fields.get('state')})
        return cursor.lastrowid

    def get_encoding(self, enc_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM encodings WHERE id = ?", (enc_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_encodings(self, recording_id: int) -> List[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM encodings WHERE recording_id = ? ORDER BY order_index",
            (recording_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def list_pending_encodings(self) -> List[dict]:
        """未完了の encodings を、途中まで進んだもの → 優先度の高い順(同値はid昇順=FIFO)で返す。

        エンコードの実行が encodings 単位で次に処理する1件を選ぶために使う。
        encode_end / encode_error は除外する。
        途中まで進んだもの(wait_encode 以外)を先にする。再起動で途中になったものより
        優先度の高い未着手を先に選ぶと、途中のものが「エンコード中」のまま残り、
        実行中が2件に見える（実測: あるエンコードが 67% のまま残り、次のエンコードを始めた）。
        """
        rows = self._get_conn().execute(
            "SELECT * FROM encodings WHERE state NOT IN ('encode_end','encode_error') "
            "ORDER BY (state = 'wait_encode') ASC, priority DESC, id ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def count_running_encodings(self) -> int:
        """実行中（エンコードの実行が処理中）の encodings 件数。
        wait_encode（未着手）と encode_end / encode_error（完了）を除いた
        中間状態（make_DB / split_ts / encoding / encoded_analyze / file_copy）を数える。
        """
        row = self._get_conn().execute(
            "SELECT COUNT(*) FROM encodings "
            "WHERE state NOT IN ('wait_encode','encode_end','encode_error')"
        ).fetchone()
        return row[0] if row else 0

    def list_shoboi_targets(self, kind: str, only_missing: bool = False) -> List[dict]:
        """(id, sid, reserve_key, start_time, shoboi_info) の一覧。only_missing ならまだ引いていない行だけ。"""
        sql = self._SHOBOI_TARGET_SQL[kind] + (" WHERE shoboi_info IS NULL" if only_missing else "")
        return [dict(r) for r in self._get_conn().execute(sql).fetchall()]

    def set_shoboi_info(self, kind: str, row_id: int, info_json: str) -> None:
        """shoboi_info だけを書く。番組表の取り直しのたびに書くので、updated_at や更新の通知は動かさない。"""
        if kind not in self._SHOBOI_TARGET_SQL:
            raise ValueError(kind)
        conn = self._get_conn()
        conn.execute(f"UPDATE {kind} SET shoboi_info = ? WHERE id = ?", (info_json, row_id))
        conn.commit()

    def list_encodings(self, state: str = None) -> List[dict]:
        # encodings は局ロゴ表示に使う onid を持たないため、recordings から補う
        # （recordings 側の他カラムは encodings と同名重複が多いため onid のみ select する）。
        base = ("SELECT e.*, r.onid AS onid FROM encodings e "
                "LEFT JOIN recordings r ON e.recording_id = r.id")
        if state:
            rows = self._get_conn().execute(
                base + " WHERE e.state = ? ORDER BY e.id DESC", (state,)
            ).fetchall()
        else:
            rows = self._get_conn().execute(base + " ORDER BY e.id DESC").fetchall()
        return [dict(r) for r in rows]

    def update_encoding(self, enc_id: int, **fields):
        if not fields:
            return
        fields['updated_at'] = datetime.now().isoformat()
        conn = self._get_conn()
        # state 変化だけをアドオンへ流したいので、書き換え前の値を取っておく
        # (この関数は progress/encode_info の更新でも高頻度に呼ばれるため)
        prev_state = None
        if 'state' in fields:
            row = conn.execute("SELECT state FROM encodings WHERE id = ?", (enc_id,)).fetchone()
            prev_state = row['state'] if row else None
            # エンコードを始めた時刻（画面が実行中の残り時間を、その1本の進み方から出すのに使う）。時差付き
            if fields['state'] == 'encoding' and prev_state != 'encoding':
                fields['encoding_started_at'] = datetime.now().astimezone().isoformat()
        set_clause = ', '.join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [enc_id]
        conn.execute(f"UPDATE encodings SET {set_clause} WHERE id = ?", values)
        conn.commit()
        if 'state' in fields:
            try:
                # 既に消えている行への更新では通知しない。UPDATE は0件で終わるのに
                # イベントだけ飛び、実体の無い「エンコード失敗」になる
                row = self.get_encoding(enc_id)
                if row is not None:
                    from logic.addons import addon_events
                    addon_events.emit_encoding_state(enc_id, prev_state, fields['state'], row)
            except Exception:
                pass

    def delete_encoding(self, enc_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM encodings WHERE id = ?", (enc_id,))
        conn.commit()

    def delete_encodings(self, recording_id: int):
        conn = self._get_conn()
        conn.execute("DELETE FROM encodings WHERE recording_id = ?", (recording_id,))
        conn.commit()
