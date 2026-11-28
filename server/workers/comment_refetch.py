"""CommentRefetchWorker — 録画が終わってしばらく経ってから、実況コメントを取り直す。

録画が終わった直後（録画の走査）に取るコメントは、過去ログAPIが追いついておらず終わり近くが欠ける
（確かめると、ほぼ全録画で1〜3割少ない。335件→453件、163件→205件など）。
エンコードも録画の直後に走ることが多く、動画も同じだけ欠けたままになっていた。
録画の終わりから 30分 と 2時間 の2回、録画と、そこから作った動画のコメントを取り直す。
件数が増えた時だけ入れ替える（refetch_recording_comments / refetch_video_comments）。
取り直したかどうかはメモリに持つ。再起動すると、3時間以内に終わった分をもう一度取り直す（数件）。
"""

import logging
from datetime import datetime, timedelta

from workers.base import IntervalWorker

logger = logging.getLogger(__name__)

#: 録画の終わりからこれだけ経ったら取り直す（段ごと）
STAGES = (timedelta(minutes=30), timedelta(hours=2))
#: これより前に終わった録画は見ない（エンコード時の取り直しで足りる）
WINDOW = timedelta(hours=3)


class CommentRefetchWorker(IntervalWorker):
    label = 'comment_refetch'
    run_first = False

    def __init__(self, config: dict, rule_db, video_db):
        super().__init__(config.get('comment_refetch_interval', 300))
        self.rule_db = rule_db
        self.video_db = video_db
        self._done = set()   # (種類, id, 段)

    def _due(self, db, kind: str, table: str):
        """取り直す時期が来た (id, 段) を返す。"""
        now = datetime.now()
        rows = db._get_conn().execute(
            f'SELECT id, recording_end_time FROM {table} '
            'WHERE sid IS NOT NULL AND recording_end_time BETWEEN ? AND ?',
            ((now - WINDOW).isoformat(), (now - STAGES[0]).isoformat())).fetchall()
        for r in rows:
            try:
                ended = datetime.fromisoformat(r['recording_end_time'])
            except (TypeError, ValueError):
                continue
            stage = max(i for i, d in enumerate(STAGES) if now - ended >= d)
            if (kind, r['id'], stage) not in self._done:
                yield r['id'], stage

    def _tick(self):
        from logic.add_recording.comments import refetch_recording_comments
        from api.video_routes.audio_sync.apply import refetch_video_comments
        # (種類, 表示名, DB, 表, 取り直し)。どちらの取り直しも {'updated', 'before', 'after'} を返す
        targets = [('rec', '録画', self.rule_db, 'recordings', refetch_recording_comments)]
        if self.video_db is not None:
            targets.append(('video', '動画', self.video_db, 'videos', refetch_video_comments))
        for kind, label, db, table, refetch in targets:
            for id_, stage in list(self._due(db, kind, table)):
                if self._stop_event.is_set():
                    return
                self._done.add((kind, id_, stage))
                try:
                    r = refetch(db, id_)
                except Exception as e:
                    logger.warning('コメントの取り直し: %s %d に失敗: %s', label, id_, e)
                    continue
                if r and r.get('updated'):
                    logger.info('コメントの取り直し: %s %d %d件→%d件', label, id_, r['before'], r['after'])
