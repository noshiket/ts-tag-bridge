"""ProgramDB の本体。メソッドは機能ごとに mixin へ分けてある。"""

import sqlite3
import threading
from .common import (  # noqa: F401
    logger,
)
from .schema import _SchemaMixin
from .rules import _RulesMixin
from .recordings import _RecordingsMixin
from .encodings import _EncodingsMixin
from .auto_encode import _AutoEncodeMixin


class ProgramDB(_SchemaMixin, _RulesMixin, _RecordingsMixin, _EncodingsMixin, _AutoEncodeMixin):
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
        self._rec_light_cols: str = None  # cached after first PRAGMA

    def _get_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, 'conn', None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        elif conn.in_transaction:
            # busy / IntegrityError 等で途中終了した書き込みが開いたまま残した
            # トランザクション。そのまま次の SELECT をするとスナップショットが
            # 固定され、他接続がコミットし続けても古い値を読み続ける。
            conn.rollback()
            # どのメソッドで漏れたかはここでは分からない
            logger.warning('スレッド接続に残っていたトランザクションを rollback した')
        return conn

    def wal_checkpoint(self):
        """rules.db-wal の肥大化を抑える best-effort チェックポイント(TRUNCATE)。
        長時間リーダーがいると即 busy で終わる。失敗しても呼び出し元を止めない。"""
        try:
            self._get_conn().execute('PRAGMA wal_checkpoint(TRUNCATE)')
        except sqlite3.OperationalError as e:
            logger.debug('wal_checkpoint(TRUNCATE) 見送り(無視): %s', e)

    # ------------------------------------------------------------------
    # disks（外部ディスク取り外し検知）
    # ------------------------------------------------------------------

    # logic/storage/disk_guard.py の DISK_MARKER と一致させること
    DISK_MARKER = '.encode_disk_id'

    # しょぼいカレンダーの情報(shoboi_info)を書く対象。kind は 'programs' か 'recordings'
    _SHOBOI_TARGET_SQL = {
        'programs': "SELECT id, sid, reserve_key, start_time, shoboi_info FROM programs",
        'recordings': "SELECT id, sid, NULL AS reserve_key, eit_start_time AS start_time, "
                      "shoboi_info FROM recordings",
    }

    # ------------------------------------------------------------------
    # auto_encode（確定値マッチで recordings.auto_send=true にするルール）
    # ------------------------------------------------------------------

    _AUTO_ENCODE_FIELDS = (
        'folder', 'title', 'sid',
        'use_folder', 'use_title', 'use_sid',
        'require_episode_name', 'require_episode_number',
        'allow_multi_episode', 'enabled',
    )
