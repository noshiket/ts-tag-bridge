"""ライブの実況コメントとキャプチャの保存"""

import data_paths
import re
from datetime import datetime
from quart import jsonify, current_app, request
from api.routes.auth import bp
from api.stream_routes.capture_owner import me as capture_owner


@bp.get('/streams/live/<display_channel_id>/jikkyo')
async def live_stream_jikkyo(display_channel_id: str):
    """
    実況コメント (NX-Jikkyo) の WebSocket 接続情報を返す
    ブラウザはこの URL に直接接続してコメントを送受信する
    """
    from media.tsukujima.live_stream import LiveStream
    from media.tsukujima.jikkyo import get_jikkyo_id

    channel_info = LiveStream.resolve_channel(display_channel_id)
    if channel_info is None:
        return jsonify({'error': f'Channel not found: {display_channel_id}'}), 404

    jikkyo_id = get_jikkyo_id(channel_info['network_id'], channel_info['service_id'])
    if jikkyo_id is None:
        # 対応する実況チャンネルが存在しない (CS など)
        return jsonify({
            'jikkyo_id': None,
            'watch_session_url': None,
            'comment_session_url': None,
        })

    base = f'wss://nx-jikkyo.tsukumijima.net/api/v1/channels/{jikkyo_id}/ws'
    return jsonify({
        'jikkyo_id': jikkyo_id,
        'watch_session_url': f'{base}/watch',
        'comment_session_url': f'{base}/comment',
    })


@bp.post('/streams/captures')
async def save_capture():
    """ライブ/録画再生のスクリーンショットを server/data/captures/ に保存する。
    body: { image: 'data:image/png;base64,...', station: '局名', channel_id: 'vdb<id>'|'rec<id>'|任意 }
    ファイル名: {局名}_{YYYYMMDD_HHMMSS}.{ext}
    channel_id が 'vdb<video_id>' 形式(video.dbの動画再生中のキャプチャ)の場合、captures
    テーブルにvideo_id付きで登録し、後でアルバム単位のキャプチャ一覧に出せるようにする。
    'rec<recording_id>' 形式(エンコード前の録画再生中のキャプチャ)の場合はrecording_idだけ
    付けて登録し、そのrecordingのエンコードが完了した時点(run_file_copy)でvideo_idへ張り替える。
    ライブ視聴時等どちらでもない場合も、持ち主（アカウントごとに見せる）を残すため番組なしで登録する。
    """
    import base64, pathlib
    data = await request.get_json(silent=True) or {}
    image = data.get('image', '')
    station = str(data.get('station', 'unknown')).strip() or 'unknown'
    channel_id = str(data.get('channel_id', ''))
    # tot: 撮った瞬間の放送時刻(絶対時刻)。キャプチャ一覧の「この位置から再生」で使う
    tot = data.get('tot') or None
    if not image.startswith('data:image/'):
        return jsonify({'error': 'invalid image'}), 400
    try:
        header, b64 = image.split(',', 1)
        ext = 'jpg' if 'jpeg' in header or 'jpg' in header else 'png'
        raw = base64.b64decode(b64)
    except Exception:
        return jsonify({'error': 'decode failed'}), 400

    try:
        safe_station = re.sub(r'[^\w\-]', '_', station)[:40]
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        cap_dir = pathlib.Path(data_paths.DATA_DIR) / 'captures'
        cap_dir.mkdir(parents=True, exist_ok=True)
        fname = f'{safe_station}_{ts}.{ext}'
    except Exception as e:
        current_app.logger.exception('capture save failed')
        return jsonify({'error': f'save failed: {e}'}), 500

    cap_row_id = None
    m = re.fullmatch(r'vdb(\d+)', channel_id)
    if m:
        db = current_app.config.get('VIDEO_DB')
        if db is not None:
            video_id = int(m.group(1))
            video = db.get_video_row(video_id)
            if video is not None:
                cap_row_id = db.add_capture(
                    fname, video_id=video_id, tot=tot,
                    onid=video.get('onid'), tsid=video.get('tsid'), sid=video.get('sid'), eid=video.get('eid'),
                    eit_title=video.get('eit_title'), eit_description=video.get('eit_description'),
                    eit_extended_info=video.get('eit_extended_info'),
                    eit_start_time=video.get('eit_start_time'), eit_end_time=video.get('eit_end_time'),
                    eit_station_name=video.get('eit_station_name'), owner=capture_owner(),
                )
    else:
        m = re.fullmatch(r'rec(\d+)', channel_id)
        if m:
            # エンコード前の録画(rules.db)再生中のキャプチャ。video_idはまだ無いので
            # recording_idだけ紐付けて保存し、エンコード完了時(run_file_copy)にvideo_idへ
            # 張り替える(link_captures_by_recording)。
            video_db = current_app.config.get('VIDEO_DB')
            rule_db = current_app.config.get('RULE_DB')
            if video_db is not None and rule_db is not None:
                recording_id = int(m.group(1))
                recording = rule_db.get_recording(recording_id)
                if recording is not None:
                    cap_row_id = video_db.add_capture(
                        fname, recording_id=recording_id, tot=tot,
                        onid=recording.get('onid'), tsid=recording.get('tsid'),
                        sid=recording.get('sid'), eid=recording.get('eid'),
                        eit_title=recording.get('eit_title'), eit_description=recording.get('eit_description'),
                        eit_extended_info=recording.get('eit_extended_info'),
                        eit_start_time=recording.get('eit_start_time'), eit_end_time=recording.get('eit_end_time'),
                        eit_station_name=recording.get('eit_station_name'), owner=capture_owner(),
                    )
                    # 既にエンコード済みの動画があれば、この場で紐づける
                    # (recording_id 経由の張り替えはエンコード完了時にしか走らないため)
                    try:
                        v = video_db.find_video_by_event(
                            recording.get('onid'), recording.get('tsid'),
                            recording.get('sid'), recording.get('eid'), tot)
                        if v:
                            video_db.relink_captures([cap_row_id], v['id'])
                    except Exception as e:
                        current_app.logger.warning('capture: 動画の照合に失敗(無視): %s', e)
    if cap_row_id is None:
        # ライブ視聴など番組の決まらない物も、持ち主を残すために行を作る（アカウントごとに見せる）
        live_db = current_app.config.get('VIDEO_DB')
        if live_db is not None:
            cap_row_id = live_db.add_capture(fname, tot=tot, eit_station_name=station, owner=capture_owner())
    # 画像そのものに EIT/TOT を埋めてから保存する。ファイル単体を別サーバーへ
    # 持ち込んでも取り込み直せるようにするため（登録行が作れなかった場合も
    # 手元の値だけで埋めておく）。
    from logic.meta import media_meta
    from logic.meta import image_meta
    db = current_app.config.get('VIDEO_DB')
    row = None
    if db is not None and cap_row_id:
        row = next((c for c in db.get_captures() if c['id'] == cap_row_id), None)
    if row is None:
        row = {'tot': tot, 'created_at': datetime.now().isoformat()}
    try:
        (cap_dir / fname).write_bytes(image_meta.embed_image_meta(raw, media_meta.build_capture_meta(row)))
    except Exception as e:
        current_app.logger.exception('capture save failed')
        return jsonify({'error': f'save failed: {e}'}), 500
    return jsonify({'ok': True, 'file': fname, 'capture_id': cap_row_id, 'video_id': (row or {}).get('video_id')})
