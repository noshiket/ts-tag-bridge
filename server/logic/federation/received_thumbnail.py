"""他のサーバーから受け取った録画のサムネを作る。

サムネ（とシークバーのタイル）は送り元のデータの置き場にあり、録画と一緒には送らない
（送り元のパスは向こうでは意味が無い）。作らないと、受け取った側の録画詳細・一覧で
サムネが空のままになっていた。受け取った TS から、録画の取り込みと同じ作り方で作る。
送り元への応答を待たせないよう、別のスレッドで作る。
"""

import logging
import threading

logger = logging.getLogger(__name__)


def start(rule_db, rec_id: int, ts_path: str, meta: dict, config: dict) -> None:
    """受け取った録画のサムネを別のスレッドで作り始める（長さが分からなければ作らない）"""
    if not meta.get('duration_sec'):
        return
    scan_fields = {'duration_sec': meta.get('duration_sec'), 'eit_genre': meta.get('eit_genre') or ''}

    def run():
        from logic.add_recording.thumbnail import _generate_recording_thumbnail
        try:
            _generate_recording_thumbnail(rule_db, rec_id, ts_path, scan_fields, config)
        except Exception as e:
            logger.warning('fed recording: rec_id=%d サムネを作れませんでした: %s', rec_id, e)

    threading.Thread(target=run, name=f'fed-thumb-{rec_id}', daemon=True).start()
