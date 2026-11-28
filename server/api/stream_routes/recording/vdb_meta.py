"""ライブラリの動画の番組情報（音楽なら曲の情報）"""

import json
import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.media import _TS_STREAMABLE_AUDIO_CODECS, _TS_STREAMABLE_VIDEO_CODECS, _caption3_tracks
from api.routes.tag_io import _load_tag, _save_tag
from ..live import _pts_gaps_of
from .playback_meta import _has_caption


def _music_info(video: dict) -> dict:
    """曲情報タブに出す、原本から取り込んだ情報一式。

    取り込み時に tag.json へ書いているが、その仕組みを入れる前に取り込んだ曲には
    入っていない。原本(source_path)が残っていれば読み直して tag.json へ書き戻す
    （has_secondary_audio を再生開始時に測り直して保存するのと同じ考え方）。
    """
    if (video.get('media_kind') or '') != 'audio':
        return {}
    tag_path = (video.get('file_path') or '') + '.tag.json'
    tag = _load_tag(tag_path) or {}
    tags, spec = tag.get('media_tags'), tag.get('source_audio')
    src = tag.get('source_path') or video.get('source_path') or ''
    if not tags and src and os.path.exists(src):
        try:
            from media.probe.media_tags import get_media_tags
            read = get_media_tags(current_app.config['ENCODE_AUTO'].get('ffprobe', 'ffprobe'), src)
            tags, spec = read.get('all') or {}, read.get('audio')
            if tags:
                tag['media_tags'] = tags
                if spec:
                    tag['source_audio'] = spec
                _save_tag(tag_path, tag)
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('_music_info: 原本を読めませんでした %s: %s', src, e)
    cover = tag.get('cover_path') or ''
    arc = tag.get('archive_path') or ''
    has_arc = bool(arc and os.path.exists(arc))
    return {
        'media_tags': tags or {},
        'source_audio': spec or {},
        'source_path': src,
        'has_source': bool(src and os.path.exists(src)),
        'has_cover_file': bool(cover and os.path.exists(cover)),
        # 可逆の控え。原本を消した後はこれが唯一の可逆音源になる
        'archive_ext': os.path.splitext(arc)[1] if has_arc else '',
        'archive_size': os.path.getsize(arc) if has_arc else 0,
        'archive_lossless': bool(tag.get('archive_lossless')) if has_arc else False,
        'has_lossless': bool(has_arc or (src and os.path.exists(src))),
    }


@bp.get('/streams/vdb/<int:video_id>/metadata')
def vdb_metadata(video_id: int):
    """video.db 動画の再生プレイヤー用メタデータを返す。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        return jsonify({'error': 'video not found'}), 404

    # 字幕トラック一覧: TS由来の字幕1/字幕2 + 後付け字幕(captions3_json の各トラック)。
    # クライアントはこの配列の順にトグルで巡回する。
    caption_tracks = []
    if _has_caption(video.get('captions_json')):
        caption_tracks.append({'key': '1', 'name': '字幕'})
    if _has_caption(video.get('captions2_json')):
        caption_tracks.append({'key': '2', 'name': '文字スーパー'})
    for i, tr in enumerate(_caption3_tracks(video.get('captions3_json'))):
        caption_tracks.append({'key': f'3:{i}', 'name': tr.get('name') or f'追加字幕{i + 1}'})
    caption_count = len(caption_tracks)
    has_tile = bool(video.get('thumbnail_tile_path') and os.path.exists(video.get('thumbnail_tile_path')))
    vdb_file_path = video.get('file_path') or ''
    # MKV/WebM も TS ではないので MP4 と同じ扱い（字幕は captions_json 側で持つ）。
    # ここを MPEG-TS にしてしまうと、下の streamable が真になって HLS 経路へ入り、
    # TS として読めないまま読み込み中で止まる
    _low = vdb_file_path.lower()
    vdb_container_format = ('MPEG-4' if _low.endswith(('.mp4', '.m4v', '.mov', '.mkv', '.webm'))
                            else 'MPEG-TS')

    # 副音声有無は登録時(add_videos)に videos.has_secondary_audio へ確定させている。
    # 判定に ffprobe(~150ms)が要るため一覧では毎回測らない。カラム導入前に登録された動画は
    # NULL(未判定)なので、ここ(再生開始時)で判定して書き戻す。
    has_secondary_audio = video.get('has_secondary_audio')
    if has_secondary_audio is None:
        from media.probe.ffprobe import detect_secondary_audio
        cfg = current_app.config['ENCODE_AUTO']
        detected = detect_secondary_audio(vdb_file_path, video.get('eit_audio_info') or '',
                                          cfg.get('ffprobe'))
        if detected is not None:
            try:
                db.set_secondary_audio(video_id, detected)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning('vdb_metadata: 副音声判定の保存に失敗 id=%s: %s', video_id, e)
        has_secondary_audio = detected
    has_secondary_audio = bool(has_secondary_audio)

    # 映像コーデック。MP4 は psisimux で MPEG-TS へ変換してからエンコーダへ渡すため、
    # そこに載らないコーデック(AV1/VP9 等)は HLS 経路が成立しない(実際 QSVEncC が
    # "error finding stream information" で落ちる)。プレイヤーはこの値を見て
    # ファイルをそのまま <video src> で再生する経路に切り替える。
    video_codec = video.get('video_codec')
    if video_codec is None and vdb_file_path:
        from media.probe.ffprobe import get_video_info
        info = get_video_info(current_app.config['ENCODE_AUTO'].get('ffprobe', 'ffprobe'),
                              vdb_file_path) or {}
        video_codec = (info.get('video') or {}).get('codec') or ''
        try:
            db.set_video_codec(video_id, video_codec)
        except Exception as e:
            import logging as _lg
            _lg.getLogger(__name__).warning('vdb_metadata: コーデックの保存に失敗 id=%s: %s',
                                            video_id, e)
    # HLS(サーバー変換)に載るのは TS そのものか、psisimux が TS 化できる MP4 だけ。
    # MKV/WebM は psisimux が読めないので直接再生へ回す。
    # 判定できなかった場合(ffprobe 失敗)は従来どおり HLS を試す
    streamable = (vdb_container_format == 'MPEG-TS'
                  or (_low.endswith(('.mp4', '.m4v'))
                      and (not video_codec or video_codec in _TS_STREAMABLE_VIDEO_CODECS)))
    # 音声も psisimux が読めるもの(AAC)でないと HLS にできない。最初の音声で見る
    # （psisimux は最初の音声を使う。音声の無い MP4 も "No audio track" で止まる）。
    # 音声のコーデックは列に持っていないので MP4 の時だけ測る(~150ms。再生を始める時だけ)。
    # 測れなかった時は従来どおり HLS を試す
    if streamable and vdb_container_format == 'MPEG-4' and vdb_file_path:
        from media.probe.ffprobe import get_video_info
        _ainfo = get_video_info(current_app.config['ENCODE_AUTO'].get('ffprobe', 'ffprobe'), vdb_file_path)
        if _ainfo is not None:
            _audios = _ainfo.get('audio') or []
            if not _audios or (_audios[0].get('codec') or '') not in _TS_STREAMABLE_AUDIO_CODECS:
                streamable = False

    # プレイヤー右パネルのシリーズ/キャプチャタブ(album/series単位の絞り込み)用に付与する
    series = db.get_series_row(video['series_id']) if video.get('series_id') is not None else None

    return jsonify({
        'duration': float(video.get('duration_sec') or 0.0),
        'container_format': vdb_container_format,
        'video_codec': video_codec or '',
        # false = HLS(サーバー再エンコード)経路に乗らない。プレイヤーは /videos/<id>/media を
        # そのまま再生する（ブラウザが直接デコードできる形式なら再生できる）
        'streamable': streamable,
        'thumbnail_info': json.loads(video['thumbnail_info']) if video.get('thumbnail_info') else None,
        'has_thumbnail_tile': has_tile,
        'has_secondary_audio': has_secondary_audio,
        'has_caption': caption_count > 0,
        'caption_count': caption_count,
        'caption_tracks': caption_tracks,
        'comment_count': int(video.get('comment_count') or 0),
        'title': video.get('eit_title') or '',
        'description': video.get('eit_description') or '',
        'extended_info': video.get('eit_extended_info') or '',
        'genre': video.get('eit_genre') or '',
        'start_time': video.get('eit_start_time') or '',
        'end_time': video.get('eit_end_time') or '',
        'station_name': video.get('eit_station_name') or '',
        'sid': video.get('sid'),
        'onid': video.get('onid'),
        'tsid': video.get('tsid'),
        'eid': video.get('eid'),
        'series_id': video.get('series_id'),
        'series_name': series.get('name') if series else None,
        'album_id': series.get('album_id') if series else None,
        # 音楽。'audio' ならプレイヤーは HLS を張らず /videos/<id>/media を直接再生し、
        # 字幕・弾幕・コマ送り等の映像向け UI を出さない
        'media_kind': video.get('media_kind') or 'video',
        'artist': video.get('artist') or '',
        # 曲情報タブ用。原本(AIFF等)から取り込んだタグ・音声仕様・原本の在処
        **_music_info(video),
        'episode_number': video.get('episode_number'),
        'episode_name': video.get('episode_name'),
        'announce': video.get('announce') or '',  # 放送異常告知(テロップ等)。none...=なし
        # 視聴履歴の TOT 逆算用: 動画は trim_segments で mp4 位置⇔TOT を相互変換
        'recording_start_time': video.get('recording_start_time') or '',
        'trim_segments': (json.loads(video['trim_segments'])
                          if isinstance(video.get('trim_segments'), str) and video.get('trim_segments')
                          else (video.get('trim_segments') or [])),
        # 受信断で記録されていない区間。TOT⇔再生位置の変換でこれを引かないと、
        # 欠落より後ろの続き再生位置・キャプチャの「▶ここから」がずれる
        'pts_gaps': _pts_gaps_of(video.get('drop_error')),
    })
