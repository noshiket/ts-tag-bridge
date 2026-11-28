"""VideoAudioScanWorker — videos.has_secondary_audio が未判定(NULL)の動画を埋めるワーカー。

has_secondary_audio は add_videos の登録時に確定させるが、カラム導入前に登録済みの動画は
NULL のまま残る。判定には ffprobe(1件あたり ~150ms)が要るため、起動時に全件を一括で
測ると数時間 I/O を占有してしまう。このワーカーは 1 tick あたり BATCH 件だけ処理し、
未判定が無くなったら自分で終了する（次回起動時は件数 0 を確認して即終了）。

判定できなかった行（ファイルが無い等）はセッション中スキップ集合に入れ、同じ行で
無限に回り続けないようにする。
"""

import logging
import os
import threading
from datetime import datetime

logger = logging.getLogger(__name__)


class VideoAudioScanWorker(threading.Thread):
    # 1 tick あたりの処理件数と tick 間隔。50件×~150ms = 約7.5秒/30秒 に抑える
    BATCH = 50

    def __init__(self, config: dict, video_db):
        super().__init__(daemon=True, name='VideoAudioScan')
        self.config = config
        self.db = video_db
        self.interval = config.get('video_audio_scan_interval', 30)
        self._stop_event = threading.Event()
        self._skipped: set[int] = set()  # 判定不能だった video id（このセッション中は再試行しない）
        self.done = 0
        self.last_error: str = None
        self.started_at = datetime.now()

    def stop(self):
        self._stop_event.set()

    def run(self):
        conn = self.db._get_conn()
        remaining = conn.execute(
            "SELECT COUNT(*) FROM videos WHERE has_secondary_audio IS NULL").fetchone()[0]
        if not remaining:
            return  # 未判定なし: 何もせず終了
        logger.info('VideoAudioScan worker started (未判定 %d 件, %d件/%d秒)',
                    remaining, self.BATCH, self.interval)
        while not self._stop_event.wait(self.interval):
            try:
                if self._tick() == 0:
                    logger.info('VideoAudioScan: 完了 (判定 %d 件 / 判定不能 %d 件)',
                                self.done, len(self._skipped))
                    return
            except Exception as e:
                logger.error('VideoAudioScan tick error: %s', e)
                self.last_error = str(e)

    def _tick(self) -> int:
        """未判定の動画を BATCH 件まで判定する。処理対象が無ければ 0 を返す。"""
        from media.probe.ffprobe import detect_secondary_audio

        conn = self.db._get_conn()
        # スキップ済みも NULL のまま残るので、その分を上乗せして取ってから除外する
        # （毎 tick で未判定行を全件フェッチしないよう LIMIT で抑える）
        rows = [r for r in conn.execute(
            "SELECT id, file_path, eit_audio_info FROM videos "
            "WHERE has_secondary_audio IS NULL ORDER BY id DESC LIMIT ?",
            (self.BATCH + len(self._skipped),)
        ).fetchall() if r['id'] not in self._skipped][:self.BATCH]
        if not rows:
            return 0

        for r in rows:
            if self._stop_event.is_set():
                break
            path = r['file_path'] or ''
            if not path or not os.path.exists(path):
                self._skipped.add(r['id'])  # ファイルが無い: 次回起動時に再挑戦する
                continue
            value = detect_secondary_audio(path, r['eit_audio_info'] or '',
                                           self.config.get('ffprobe'))
            if value is None:
                self._skipped.add(r['id'])
                continue
            self.db.set_secondary_audio(r['id'], value)
            self.done += 1
        return len(rows)
