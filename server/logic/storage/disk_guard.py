"""外部ディスクのマーカーファイル管理と取り外し検知。

取り外し可能な外部ディスク（ルート以外の別ファイルシステム）の直下に
.encode_disk_id という UUID マーカーを置き、ディスクの同一性とオンライン状態を
判定する。ディスク取り外し時にファイル消失を「削除」と誤認しないために使う。

判定は os.path.ismount に依存しない（Docker の bind mount では常に True に
見えるため）。マウント点直下のマーカー有無で「オンライン/取り外し中」を、
マーカーの中身（ID）で「正しいディスクか」を判定する。
Docker 運用時はホストの umount を伝播させるため `:rslave` propagation が前提。
"""

import logging
import os
import uuid

from logic.storage.mount_point import get_mount_points

logger = logging.getLogger(__name__)

# マーカーファイル名（db/rule_db.py の ProgramDB.DISK_MARKER と一致させること）
DISK_MARKER = '.encode_disk_id'


def register_path_disk(db, path: str) -> None:
    """path のマウントポイントを解決し、外部ディスク(/以外)ならマーカーを用意して disks に登録する。

    オンライン(マウント済み)のときだけマーカーを生成/読み取りする。
    内蔵(マウントポイント=/)は is_external=0 で登録（マーカーなし）。
    """
    if not path:
        return
    try:
        mp = get_mount_points([path]).get(path, '/')
    except Exception as e:
        logger.warning('register_path_disk: マウント解決失敗 %s: %s', path, e)
        return

    is_external = 1 if mp != '/' else 0
    disk_id = None
    if is_external:
        marker = os.path.join(mp, DISK_MARKER)
        try:
            if os.path.exists(marker):
                with open(marker, encoding='utf-8') as f:
                    disk_id = f.read().strip()
            if not disk_id:
                disk_id = uuid.uuid4().hex
                with open(marker, 'w', encoding='utf-8') as f:
                    f.write(disk_id)
                logger.info('register_path_disk: マーカー生成 %s (%s)', marker, disk_id)
        except OSError as e:
            logger.warning('register_path_disk: マーカー操作失敗 %s: %s', marker, e)
            disk_id = None

    db.upsert_disk(mp, disk_id, is_external)


def is_disk_online(path: str) -> bool:
    """path のマウントポイントを解決し、外部ディスクならマーカー(.encode_disk_id)の
    有無でオンライン判定する。内蔵(マウント点=/)は常に True。

    ディスク取り外し中に物理ファイル削除を行って孤児化/誤削除するのを防ぐために使う。
    """
    if not path:
        return False
    try:
        mp = get_mount_points([path]).get(path, '/')
    except Exception as e:
        logger.warning('is_disk_online: マウント解決失敗 %s: %s', path, e)
        return False
    if mp == '/':
        return True
    return os.path.exists(os.path.join(mp, DISK_MARKER))


def register_encode_dirs(db, config: dict) -> None:
    """config.encode_dir_list の各パスのディスクを登録する（起動時などに呼ぶ）。"""
    for p in (config.get('encode_dir_list') or []):
        register_path_disk(db, p)
