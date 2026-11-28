"""録画のサムネイルを作る"""

import data_paths
import json
from .parse import logger


def _generate_recording_thumbnail(
    db, rec_id: int, ts_path: str, scan_fields: dict, config: dict,
    video_pid: int = None,
) -> None:
    """AR2 後に eit_genre / duration_sec が確定した状態でサムネイルを生成し DB を更新する。"""
    duration_sec = scan_fields.get('duration_sec')
    if duration_sec is None:
        return
    try:
        import pathlib
        from media.tsukujima.thumbnail_generator import ThumbnailGenerator
        thumbnails_dir = pathlib.Path(data_paths.DATA_DIR) / 'thumbnails'
        thumbnails_dir.mkdir(parents=True, exist_ok=True)
        gen = ThumbnailGenerator.from_recording(
            recording_id=rec_id,
            ts_path=ts_path,
            duration_sec=duration_sec,
            eit_genre_str=scan_fields.get('eit_genre', ''),
            ffmpeg_path=config.get('ffmpeg', 'ffmpeg'),
            thumbnails_dir=thumbnails_dir,
            video_pid=video_pid,
        )
        thumbnail_path, tile_path = gen.generate_and_save()
        if thumbnail_path:
            db.update_recording(rec_id,
                thumbnail_path=thumbnail_path,
                thumbnail_tile_path=tile_path,
                thumbnail_info=json.dumps(gen.build_thumbnail_info(tile_path), ensure_ascii=False),
            )
            logger.debug('add_recording: recording_id=%d thumbnail OK', rec_id)
        else:
            logger.warning('add_recording: recording_id=%d thumbnail generation failed', rec_id)
    except Exception as e:
        logger.warning('add_recording: recording_id=%d thumbnail failed: %s', rec_id, e)
