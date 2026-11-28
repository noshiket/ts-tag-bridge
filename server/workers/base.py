"""一定間隔で _tick() を回すワーカーの外枠。

stop() で止まる。_tick() の例外は last_error に残し、ワーカーは止めない。
ログは各ワーカーのモジュール名で出す（ログの絞り込みが今までと同じに効くように）。
"""

import logging
import threading
from datetime import datetime


class IntervalWorker(threading.Thread):
    #: スレッドとログの見出しに出す名前（例: 'reserve_sync'）
    label = ''
    #: ログの名前。None ならクラスのあるモジュール名
    log_name = None
    #: 起動直後に1回動かすか。False なら最初の間隔を待ってから
    run_first = True

    def __init__(self, interval):
        super().__init__(daemon=True, name=self.label)
        self.interval = interval
        self._stop_event = threading.Event()
        self.last_run: str = None
        self.last_error: str = None
        self._log = logging.getLogger(self.log_name or type(self).__module__)

    def stop(self):
        self._stop_event.set()

    def _on_start(self):
        """ループに入る前に1回だけ呼ぶ。"""

    def run(self):
        self._on_start()
        self._log.info('%s worker started (interval=%ds)', self.label, self.interval)
        if self.run_first:
            self._safe_tick()
        while not self._stop_event.wait(self.interval):
            self._safe_tick()

    def _safe_tick(self):
        try:
            self._tick()
            self.last_run = datetime.now().isoformat()
            self.last_error = None
        except Exception as e:
            self._log.error('%s tick error: %s', self.label, e)
            self.last_error = str(e)

    def _tick(self):
        raise NotImplementedError
