"""ドロップ・メタ情報"""

from media.tsukujima.quality import display_aspect
import os
from quart import jsonify, current_app
from api.routes.auth import bp  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from ..recording_source import _VIDEO_CODEC_MAP, _broadcast_ids  # noqa: F401
from .drops import _build_drops_payload  # noqa: F401


@bp.get('/streams/video/<int:rec_id>/drops')
def video_drops(rec_id: int):
    """録画再生のシークバー表示用に、ドロップ/スクランブル位置を「秒」で返す。

    対象は欠落(PACKET_LOSS)とスクランブルのみ。DUPLICATE_PACKET など無害なものは除外する。
    秒位置の求め方は _build_drops_payload を参照。

    Returns: {"duration": float, "drops": [sec, ...], "scramble": [{"start": sec, "end": sec}, ...]}
    """
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        return jsonify({'error': 'recording not found'}), 404

    duration = float(recording.get('duration_sec') or 0.0)
    out = {'duration': duration}
    out.update(_build_drops_payload(recording.get('drop_error'), duration,
                                    recording.get('recording_start_time'),
                                    recording.get('recording_end_time')))
    return jsonify(out)


# ---------------------------------------------------------------------------
# video.db ストリーミング（/api/streams/vdb/）
# ---------------------------------------------------------------------------

def _build_video_source_from_vdb(video_id: int):
    """video.db の video_id から録画再生用の VideoSource を組み立てる。"""
    from media.tsukujima.video_stream import VideoSource

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return None, None
    video = db.get_video_row(video_id)
    if video is None:
        return None, None

    ts_path = video.get('file_path', '')
    if not ts_path or not os.path.exists(ts_path):
        return None, video

    container_format = 'MPEG-4' if ts_path.lower().endswith(('.mp4', '.m4v')) else 'MPEG-TS'

    key_frames = []
    if container_format == 'MPEG-TS':
        from read_tsprogram import scanner as _ts
        try:
            _drop_json, key_frames = _ts.check_drops_and_key_frames(ts_path)
        except Exception:
            key_frames = []

    duration = float(video.get('duration_sec') or 0.0)

    cfg = current_app.config['ENCODE_AUTO']
    from media.probe.ffprobe import get_video_info
    probe = get_video_info(cfg.get('ffprobe', 'ffprobe'), ts_path)
    vinfo = (probe or {}).get('video') or {}
    video_codec = _VIDEO_CODEC_MAP.get(vinfo.get('codec', ''), 'MPEG-2')
    width = int(vinfo.get('width') or 1920)
    height = int(vinfo.get('height') or 1080)
    fps = float(vinfo.get('fps') or 0.0)

    # スキャン種別は実 MP4 の field_order を優先し、未報告時のみ EIT にフォールバックする。
    # ライブラリの MP4 は放送(1080i)由来でも既にプログレッシブ化済みのことが多く、EIT だけで
    # 判定すると誤って Interlaced 扱いになり、再生時に不要なデインターレース/フレームレート変換が
    # 入って VFR タイムラインが崩れる（字幕ズレ・画質劣化の原因）。
    fo = (vinfo.get('field_order') or '').lower()
    if fo == 'progressive':
        scan_type = 'Progressive'
    elif fo in ('tt', 'bb', 'tb', 'bt'):
        scan_type = 'Interlaced'
    else:
        token = (video.get('eit_video_info') or '').split(',')[0].strip().split(' ')[0]
        scan_type = 'Progressive' if token.endswith('p') else 'Interlaced'

    _onid, _tsid, _sid = _broadcast_ids(video)
    src = VideoSource(
        id=video_id, file_path=ts_path, duration=duration,
        video_frame_rate=fps, key_frames=key_frames, container_format=container_format,
        video_codec=video_codec, video_scan_type=scan_type,
        video_resolution_width=width, video_resolution_height=height,
        video_display_aspect=display_aspect(width, height, vinfo.get('sar')),
        network_id=_onid, transport_stream_id=_tsid, service_id=_sid,
    )
    return src, video


