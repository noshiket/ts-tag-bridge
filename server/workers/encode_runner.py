"""エンコードの実行ワーカー — pending な encoding を Amatsukaze エンコードへ直列投入するディスパッチャ。

encodings 単位で動作する。interval ごとに未完了 encoding（encode_end / encode_error
以外）を enc.id 昇順（完全 FIFO）で 1 件選び、run_one_encoding を同期実行する。
同期実行なのでワーカー内で 1 本ずつ自然に直列化される（recording をまたいで
インターリーブし得る）。recordings.state は run_one_encoding 内で encodings から
rollup される。
"""

import logging
from datetime import datetime

from logic.encoding import encode_pause
from logic.encode_pipeline.runner.run import run_one_encoding
from logic.encode_pipeline.base.context import _update_recording_rollup
from workers.base import IntervalWorker

logger = logging.getLogger(__name__)


class EncodeRunnerWorker(IntervalWorker):
    """
    interval 秒ごとに以下を行う:
      1. 未完了 encoding を enc.id 昇順で 1 件選ぶ（無ければ何もしない）
      2. run_one_encoding を同期実行（split_ts → … → encode_end / encode_error）
      3. エンコード履歴の上限プルーニングを点検

    make_DB（encodings 行作成）はここでは行わない。「エンコードキューに追加」/
    make_DB retry 時に create_encodings で作成済みの行（state=wait_encode）を拾う。
    """

    # 起動時の stale な mid-state encoding は未完了として拾われ、run_one_encoding 内の
    # _verify_and_route が成果物から再開するため明示リセットは不要。
    label = 'encode_runner'

    def __init__(self, config: dict, db):
        super().__init__(config.get('phase_c_interval', 30))
        self.config = config
        self.db = db
        self.started_at = datetime.now()

    def _tick(self):
        # 停止中は新しい1本を取り出さない。実行中のものは run_one_encoding が
        # 同期実行中なのでそのまま完走し、以降は待機のまま止まる。
        if encode_pause.is_paused():
            return

        pending = self.db.list_pending_encodings()
        if not pending:
            return

        enc = pending[0]
        enc_id = enc['id']
        recording_id = enc['recording_id']

        logger.info('エンコードの実行: dispatch enc_id=%d (recording_id=%d) → run_one_encoding',
                    enc_id, recording_id)
        # 同期実行（このスレッドをブロック＝自然に直列）。run_one_encoding は内部で
        # ステップ例外を encode_error に回収するが、解決前の例外に備えて保険を掛ける。
        try:
            run_one_encoding(self.db, enc_id, self.config, stop_event=self._stop_event)
        except Exception as e:
            logger.error('エンコードの実行: run_one_encoding failed for enc_id=%d: %s', enc_id, e)
            cur = self.db.get_encoding(enc_id)
            if cur and cur.get('state') not in ('encode_end', 'encode_error'):
                self.db.update_encoding(enc_id, state='encode_error', error_message=str(e))
                _update_recording_rollup(self.db, recording_id)

        # エンコードが1本終わるたびにエンコード履歴の上限プルーニングを点検
        try:
            from logic.encoding.encode_history import prune_encode_history
            prune_encode_history(self.db, self.config)
        except Exception as e:
            logger.error('エンコードの実行: prune_encode_history failed: %s', e)
