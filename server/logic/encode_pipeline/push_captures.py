"""ライブラリへ送るキャプチャ（置き場所・集める・送った後の片付け）"""

import data_paths
import os
from .common import logger
from .base.context import _get_video_db


def _captures_dir() -> str:
    """キャプチャ画像の置き場(server/data/captures)。captures.path はファイル名のみを保持する。"""
    return os.path.join(data_paths.DATA_DIR, 'captures')


def _collect_push_captures(recording_id: int) -> list:
    """federation push でマスターへ一緒に転送するキャプチャ行(未リンク+recording_id一致)を
    集める(best-effort。失敗しても push 自体は続行させる)。"""
    try:
        return _get_video_db().get_captures_by_recording(recording_id)
    except Exception as e:
        logger.warning('_collect_push_captures: recording_id=%s failed: %s', recording_id, e)
        return []


def _cleanup_pushed_captures(caps: list) -> None:
    """push成功後、転送済みキャプチャ(画像ファイル+captures行)をこのノードから削除する
    (「移動」なのでマスター側に登録された時点でローカルには残さない。best-effort)。"""
    if not caps:
        return
    try:
        vdb = _get_video_db()
        for c in caps:
            p = os.path.join(_captures_dir(), os.path.basename(str(c.get('path') or '')))
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError as e:
                logger.warning('_cleanup_pushed_captures: %s 削除失敗: %s', p, e)
            vdb.delete_capture(c['id'])
        logger.info('_cleanup_pushed_captures: push済みキャプチャ%d件を削除', len(caps))
    except Exception as e:
        logger.warning('_cleanup_pushed_captures failed: %s', e)
