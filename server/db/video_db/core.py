"""VideoDB の本体。メソッドは機能ごとに mixin へ分けてある。"""

import sqlite3
import threading
from .common import (  # noqa: F401
    logger,
)
from .schema import _SchemaMixin
from .ingest import _IngestMixin
from .categories import _CategoriesMixin
from .albums import _AlbumsMixin
from .videos import _VideosMixin
from .episodes import _EpisodesMixin
from .edits import _EditsMixin
from .captures import _CapturesMixin


class VideoDB(_SchemaMixin, _IngestMixin, _CategoriesMixin, _AlbumsMixin, _VideosMixin, _EpisodesMixin, _EditsMixin, _CapturesMixin):
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()

    def _get_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, 'conn', None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
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
