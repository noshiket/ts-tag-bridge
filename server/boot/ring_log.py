"""画面から見るログの受け皿（直近の行を持っておく）"""

import logging
import logging.handlers
import collections
import threading


class RingBufferHandler(logging.Handler):
    """直近のログレコードをメモリ上に保持するハンドラ（設定→アプリのログ用）。

    HTTPアクセスログは入れない。1リクエストごとに1行出るため、2000件の枠が
    数分で埋まり、パターン保存やアドオンの結果といった追いたい行が流れてしまう
    （実測: 800件中665件が uvicorn.access で、text_parser の行は1件だけ残っていた）。
    アクセスログはファイル側(/tmp/ts-tag-bridge.log。scripts/server.sh の TSTAG_LOG)には従来どおり残る。
    """

    SKIP_LOGGERS = ('uvicorn.access',)

    def __init__(self, capacity=2000):
        super().__init__()
        self._buf = collections.deque(maxlen=capacity)
        self._lock_obj = threading.Lock()

    def emit(self, record):
        if record.name in self.SKIP_LOGGERS:
            return
        entry = {
            'time': self.format(record),
            'level': record.levelname,
            'name': record.name,
            'message': record.getMessage(),
        }
        with self._lock_obj:
            self._buf.append(entry)

    def get_entries(self, limit=500, level=None):
        with self._lock_obj:
            items = list(self._buf)
        if level:
            items = [e for e in items if e['level'] == level.upper()]
        return items[-limit:]
