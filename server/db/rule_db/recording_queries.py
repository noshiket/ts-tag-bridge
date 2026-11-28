"""録画の行を引く（番号・ファイル・番組・状態で）と、一覧の軽い列"""

from typing import Optional, List
from .common import _RECORDING_HEAVY_COLS


class _RecordingQueriesMixin:
    """録画の行を引く（番号・ファイル・番組・状態で）と、一覧の軽い列"""

    def list_rules_without_reserve(self) -> List[dict]:
        """EDCB に紐づかない予約（reserve_id が無い programs 行）。

        予約一覧は EDCB の enum_reserve_info を起点に組んでいるため、
        アドオンなどが直接入れた予約はこちらから拾わないと画面に出ない。
        """
        rows = self._get_conn().execute(
            "SELECT * FROM programs WHERE reserve_id IS NULL "
            "ORDER BY start_time").fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_recording(self, rec_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM recordings WHERE id = ?", (rec_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def get_recording_by_rec_id(self, edcb_rec_id: int) -> Optional[dict]:
        """EDCB の rec_id（edcb_rec_id）で recordings を検索する。"""
        row = self._get_conn().execute(
            "SELECT * FROM recordings WHERE rec_id = ? ORDER BY id DESC LIMIT 1", (edcb_rec_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def get_recording_by_host_path(self, host_ts_path: str) -> Optional[dict]:
        """host_ts_path で recordings を検索する（手動登録の重複防止用）。最新1件を返す。"""
        row = self._get_conn().execute(
            "SELECT * FROM recordings WHERE host_ts_path = ? ORDER BY id DESC LIMIT 1",
            (host_ts_path,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def find_recordings_by_event(self, onid: int, tsid: int, sid: int, eid: int,
                                 eit_start_time: str) -> List[dict]:
        """同一放送イベント(サービス4ID + eit_start_time 完全一致)の recordings を返す。
        federation の push 受信時に、マスター/スレーブ双方で録画した重複の検出に使う。"""
        rows = self._get_conn().execute(
            "SELECT * FROM recordings WHERE onid=? AND tsid=? AND sid=? AND eid=? "
            "AND eit_start_time=? ORDER BY id",
            (onid, tsid, sid, eid, eit_start_time)
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_recordings(self, program_id: int) -> List[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM recordings WHERE program_id = ? ORDER BY id",
            (program_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def list_recordings_by_state(self, state: str, newest_first: bool = False) -> List[dict]:
        # newest_first: 放送開始(eit_start_time)が新しい順。NULL は末尾。同時刻は id 降順。
        # 解析を手動で中止した録画(scan_cancelled=1)は pending でも自動では拾わない
        # （中止直後にワーカーがそのまま再開してしまうのを防ぐ。手動の再スキャンで解除する）。
        order = ("eit_start_time DESC, id DESC" if newest_first else "id ASC")
        rows = self._get_conn().execute(
            f"SELECT * FROM recordings WHERE state = ? AND COALESCE(scan_cancelled, 0) = 0 "
            f"ORDER BY {order}",
            (state,)
        ).fetchall()
        return [dict(r) for r in rows]

    def recording_columns(self) -> set:
        """recordings の列名。転送で受け取った内容を入れる前の絞り込みに使う。"""
        conn = self._get_conn()
        return {r[1] for r in conn.execute("PRAGMA table_info(recordings)")}

    def _recordings_light_columns(self) -> str:
        """recordings から大容量ブロブ列(_RECORDING_HEAVY_COLS)を除いた列リストを返す。スキーマは不変なのでキャッシュ。"""
        if self._rec_light_cols is None:
            conn = self._get_conn()
            cols = [r[1] for r in conn.execute("PRAGMA table_info(recordings)")]
            self._rec_light_cols = ", ".join(c for c in cols if c not in _RECORDING_HEAVY_COLS)
        return self._rec_light_cols

    def list_recordings(self, state: str = None) -> List[dict]:
        cols = self._recordings_light_columns()
        if state:
            rows = self._get_conn().execute(
                f"SELECT {cols} FROM recordings WHERE state = ? ORDER BY id DESC",
                (state,)
            ).fetchall()
        else:
            rows = self._get_conn().execute(
                f"SELECT {cols} FROM recordings ORDER BY id DESC"
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def list_manual_recordings(self) -> List[dict]:
        """rec_id が NULL の手動登録エントリ一覧。"""
        rows = self._get_conn().execute(
            "SELECT * FROM recordings WHERE rec_id IS NULL ORDER BY id DESC"
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]
