"""UsersDB の本体。メソッドは機能ごとに mixin へ分けてある。"""

import sqlite3
import threading
from .common import (  # noqa: F401
    logger,
)
from .schema import _SchemaMixin
from .users import _UsersMixin
from .playlists import _PlaylistsMixin
from .history import _HistoryMixin


class UsersDB(_SchemaMixin, _UsersMixin, _PlaylistsMixin, _HistoryMixin):
    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()

    def _conn(self):
        # video_db.py と同じ形。スレッドごとに接続を開いて使い回す（呼び出しごとに
        # 新規接続を開かない）。接続はスレッド寿命まで開いたまま。
        c = getattr(self._local, 'conn', None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30.0)
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA foreign_keys=ON')
            self._local.conn = c
        elif c.in_transaction:
            # busy / IntegrityError 等で途中終了した書き込みが開いたまま残した
            # トランザクション。そのまま次の SELECT をするとスナップショットが
            # 固定され、他接続がコミットし続けても古い値を読み続ける。
            c.rollback()
            # どのメソッドで漏れたかはここでは分からない
            logger.warning('スレッド接続に残っていたトランザクションを rollback した')
        return c

    # ── user_perms（管理者が与えるアクセス権）────────────────────────────

    PERM_DEFAULT = {'screens': [], 'nodes': [], 'stations': [],
                    'deny_categories': [], 'can_write': 0, 'guides': [], 'paid': 0}
    _PERM_LISTS = ('screens', 'nodes', 'stations', 'deny_categories', 'guides')

    # 「続きを見る」に返す件数。1件200バイト程度なので数千件でも数百KBに収まる。
    # 以前は300件で、それを超えると古い視聴が一覧から消えていた。
    WATCH_HISTORY_LIMIT = 3000

    # 再生回数を1つ増やす進捗のしきい値（ここを越えたら「1回見た」とみなす）。
    # 端の数分は次回予告やEDのことが多く、そこまで見れば1回と数えてよい。
    WATCH_COMPLETE_RATIO = 0.9
