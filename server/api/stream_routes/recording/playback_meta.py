"""録画の再生の番組情報（字幕の有無・並びの値の扱い）"""

import json
import os
from quart import jsonify, current_app
from api.routes.auth import bp
from api.routes.parser import _ruledb
from ..live import _pts_gaps_of


def _list_first(v):
    """確定値の列。複数話はリスト(またはJSON配列文字列)で入るので先頭を返す。"""
    import json as _j
    if isinstance(v, str) and v.startswith('['):
        try:
            v = _j.loads(v)
        except (ValueError, TypeError):
            return v
    if isinstance(v, list):
        return next((str(x) for x in v if x not in (None, '')), '')
    return v or ''


def _list_join(v):
    """同上。複数話は ', ' で連結して返す（画面はそのまま出す）。"""
    import json as _j
    if isinstance(v, str) and v.startswith('['):
        try:
            v = _j.loads(v)
        except (ValueError, TypeError):
            return v
    if isinstance(v, list):
        return ', '.join(str(x) for x in v if x not in (None, ''))
    return v if v not in (None, '') else ''


def _has_caption(raw) -> bool:
    """captions_json(字幕1)/captions2_json(字幕2) の captions 配列が空でないか。

    tsreadex はダミー字幕ストリームを常に出力するため、ソースに実字幕があるかは
    この DB 値で判定する。
    """
    if not raw:
        return False
    try:
        j = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return False
    caps = j.get('captions') if isinstance(j, dict) else j
    return isinstance(caps, list) and len(caps) > 0


@bp.get('/streams/video/<int:rec_id>/metadata')
def video_metadata(rec_id: int):
    """録画再生プレイヤー用のメタデータ（再生時間・シークバーサムネ情報・副音声有無）を返す。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        return jsonify({'error': 'recording not found'}), 404

    thumbnail_info = recording.get('thumbnail_info')
    if isinstance(thumbnail_info, str):
        try:
            thumbnail_info = json.loads(thumbnail_info)
        except Exception:
            thumbnail_info = None

    # 副音声有無: probe_result の音声トラック数 or EIT 音声情報（デュアルモノ/二重音声）から推定
    has_secondary_audio = False
    probe = recording.get('probe_result')
    if isinstance(probe, str):
        try:
            probe = json.loads(probe)
        except Exception:
            probe = None
    # 通常 probe は先頭しか解析せず、後から現れる副音声(解説放送/二カ国語の第2音声)を
    # 取りこぼすため、実ストリームから音声本数を深く解析して数える（結果は probe_result にキャッシュ）。
    audio_count = None
    if isinstance(probe, dict) and isinstance(probe.get('audio_stream_count'), int):
        audio_count = probe['audio_stream_count']
    if audio_count is None:
        ts_path = (recording.get('app_ts_path') or recording.get('host_ts_path')
                   or recording.get('edcb_ts_path', ''))
        if ts_path and os.path.exists(ts_path):
            from media.probe.ffprobe import count_audio_streams
            cfg = current_app.config['ENCODE_AUTO']
            audio_count = count_audio_streams(cfg.get('ffprobe', 'ffprobe'), ts_path,
                                              service_id=recording.get('sid'))
            if audio_count is not None:
                # probe_result にキャッシュ（次回以降は深い解析を省く）
                merged = probe if isinstance(probe, dict) else {}
                merged['audio_stream_count'] = audio_count
                db.update_recording(rec_id, probe_result=json.dumps(merged, ensure_ascii=False))
    if isinstance(audio_count, int) and audio_count >= 2:
        has_secondary_audio = True
    elif isinstance(probe, dict) and isinstance(probe.get('audio'), list) and len(probe['audio']) >= 2:
        has_secondary_audio = True
    # デュアルモノ(二重音声)は音声ストリームが1本（L=主/R=副）なので本数では検出できない。
    # EIT 音声モードで判定する（tsreadex -a 13 が L/R を主/副に分離する）。
    eit_audio = recording.get('eit_audio_info') or ''
    if ('デュアル' in eit_audio) or ('1/0+1/0' in eit_audio) or ('二重' in eit_audio):
        has_secondary_audio = True

    has_tile = bool(recording.get('thumbnail_tile_path') and os.path.exists(recording.get('thumbnail_tile_path')))

    # 字幕有無は DB の値で判定する（_has_caption）
    caption_count = int(_has_caption(recording.get('captions_json'))) + int(_has_caption(recording.get('captions2_json')))

    ts_path = (recording.get('app_ts_path') or recording.get('host_ts_path')
               or recording.get('edcb_ts_path', ''))
    container_format = 'MPEG-4' if ts_path.lower().endswith(('.mp4', '.m4v')) else 'MPEG-TS'

    return jsonify({
        'duration': float(recording.get('duration_sec') or 0.0),
        'thumbnail_info': thumbnail_info,
        'has_thumbnail_tile': has_tile,
        'has_secondary_audio': has_secondary_audio,
        'has_caption': caption_count > 0,
        'caption_count': caption_count,
        'comment_count': int(recording.get('comment_count') or 0),
        'container_format': container_format,
        'title': recording.get('eit_title') or '',
        'description': recording.get('eit_description') or '',
        'extended_info': recording.get('eit_extended_info') or '',
        'genre': recording.get('eit_genre') or '',
        'start_time': recording.get('eit_start_time') or '',
        'end_time': recording.get('eit_end_time') or '',
        'station_name': recording.get('eit_station_name') or '',
        'sid': recording.get('sid'),
        'onid': recording.get('onid'),
        'tsid': recording.get('tsid'),
        'eid': recording.get('eid'),
        # 解析で決まった値。番組情報タブに放送のタイトルと分けて出す
        # （複数話の録画はリストで入るので、そのまま渡して画面側で連結する）
        'series_name': _list_first(recording.get('folder')) or _list_first(recording.get('title')),
        'episode_number': _list_join(recording.get('episode_number')),
        'episode_name': _list_join(recording.get('episode_name')),
        # 視聴履歴の TOT 逆算用: 録画は位置0 ≈ recording_start_time（TOTアンカー）
        'recording_start_time': recording.get('recording_start_time') or '',
        # 受信断で記録されていない区間。TOT⇔再生位置の変換でこれを引く
        'pts_gaps': _pts_gaps_of(recording.get('drop_error')),
    })
