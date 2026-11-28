"""録画の配信の元（コーデック・放送の識別・VideoSource を作る）"""

from media.tsukujima.quality import display_aspect
import json
import os
from quart import current_app
from api.routes.parser import _ruledb


# ffprobe の codec_name → 内部コーデック表記
_VIDEO_CODEC_MAP = {'mpeg2video': 'MPEG-2', 'h264': 'H.264', 'hevc': 'H.265'}


def _streaming_encoder():
    """config.yml streaming.encoder（既定 FFmpeg）を返す。"""
    return (current_app.config['ENCODE_AUTO'].get('streaming', {}) or {}).get('encoder', 'FFmpeg')


def _broadcast_ids(row: dict):
    """psisimux / tsreadex に渡す (onid, tsid, sid)。揃っていなければ全て None。

    psisimux は -b <onid>/<tsid>/<sid> を3つ揃いで要求する。片方だけ欠けた行を
    そのまま渡すと 'None/None/9000' という文字列になり
    'Error: argument 4 is invalid.' で何も出力されない。その空の TS を受けた
    QSVEncC が 'avqsv: error finding stream information.' で10回リトライして
    セッションごと死に、プレイヤーは中身の来ないセグメントを待ち続ける
    （実測: 配信を取り込むアドオンが録った動画。sid だけ入っていて
    onid/tsid が NULL）。放送由来でない録画には本物の onid/tsid が存在しないので、
    3つ揃っている時だけ本物を使い、そうでなければ呼び出し側の
    「service_id が None なら 1/2/3 と -n -1」という既定の経路へ倒す。
    """
    onid, tsid, sid = row.get('onid'), row.get('tsid'), row.get('sid')
    if onid is None or tsid is None or sid is None:
        return None, None, None
    return onid, tsid, sid


def _build_video_source(rec_id: int):
    """recordings.id から録画再生用の VideoSource を組み立てる。
    戻り値: (VideoSource | None, recording dict | None)。TS 不在/未収集なら None。
    """
    from media.tsukujima.video_stream import VideoSource

    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        return None, None
    ts_path = (recording.get('app_ts_path') or recording.get('host_ts_path')
               or recording.get('edcb_ts_path', ''))
    if not ts_path or not os.path.exists(ts_path):
        return None, recording

    # コンテナフォーマット判定（拡張子で判別）
    container_format = 'MPEG-4' if ts_path.lower().endswith(('.mp4', '.m4v')) else 'MPEG-TS'

    # key_frames（ingest 収集）。MPEG-TS のみ対象（MP4 は再生時に moov から取得）
    key_frames = []
    if container_format == 'MPEG-TS':
        raw_kf = recording.get('key_frames')
        if raw_kf:
            try:
                key_frames = json.loads(raw_kf)
            except Exception:
                pass
        if not key_frames:
            from read_tsprogram import scanner as _ts
            try:
                _drop_json, key_frames = _ts.check_drops_and_key_frames(ts_path)
                db.update_recording(rec_id, key_frames=json.dumps(key_frames, ensure_ascii=False))
            except Exception:
                key_frames = []

    duration = float(recording.get('duration_sec') or 0.0)

    # probe_result を遅延参照（無ければ get_video_info でキャッシュ）
    probe = recording.get('probe_result')
    if isinstance(probe, str):
        try:
            probe = json.loads(probe)
        except Exception:
            probe = None
    if not probe:
        from media.probe.ffprobe import get_video_info
        cfg = current_app.config['ENCODE_AUTO']
        probe = get_video_info(cfg.get('ffprobe', 'ffprobe'), ts_path)
        if probe:
            db.update_recording(rec_id, probe_result=json.dumps(probe, ensure_ascii=False))
    vinfo = (probe or {}).get('video') or {}

    video_codec = _VIDEO_CODEC_MAP.get(vinfo.get('codec', ''), 'MPEG-2')
    width = int(vinfo.get('width') or 1920)
    height = int(vinfo.get('height') or 1080)
    fps = float(vinfo.get('fps') or 0.0)

    # スキャン方式は eit_video_info の解像度クラス（"1080i (1125i), ..."）から判定
    scan_type = 'Interlaced'
    token = (recording.get('eit_video_info') or '').split(',')[0].strip().split(' ')[0]
    if token.endswith('p'):
        scan_type = 'Progressive'
    elif token.endswith('i'):
        scan_type = 'Interlaced'

    _onid, _tsid, _sid = _broadcast_ids(recording)
    src = VideoSource(
        id=rec_id, file_path=ts_path, duration=duration,
        video_frame_rate=fps, key_frames=key_frames, container_format=container_format,
        video_codec=video_codec, video_scan_type=scan_type,
        video_resolution_width=width, video_resolution_height=height,
        video_display_aspect=display_aspect(width, height, vinfo.get('sar')),
        network_id=_onid, transport_stream_id=_tsid, service_id=_sid,
    )
    return src, recording
