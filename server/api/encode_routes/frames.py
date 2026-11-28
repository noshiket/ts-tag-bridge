"""録画のサムネ・フレーム・プレビュー・HLS"""

import json
import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401


@bp.get('/encode/encodings/<int:enc_id>/thumbnail')
def thumbnail_encoding(enc_id):
    """エンコード結果のサムネ(WebP)を返す。run_encoded_analyze が生成したサムネを使う。
      1. 最終パス（app_output_path stem + .thumbnail.webp）— 出力動画と一緒に残る
      2. encode_info.thumbnail_path（一次ファイル生成元）— エンコード直後/コピー前用
      3. フォールバック: 録画TSのサムネ
    """
    from quart import Response
    from logic.encode_pipeline.common import _apply_encode_dir
    db = _ruledb()
    enc = db.get_encoding(enc_id)
    if enc is None:
        abort(404)

    candidates = []
    app_out = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir'))
    if app_out:
        candidates.append(os.path.splitext(app_out)[0] + '.thumbnail.webp')
    raw_ei = enc.get('encode_info')
    if raw_ei:
        try:
            ei = json.loads(raw_ei) if isinstance(raw_ei, str) else raw_ei
            if isinstance(ei, dict) and ei.get('thumbnail_path'):
                candidates.append(ei['thumbnail_path'])
        except Exception:
            pass
    for p in candidates:
        if p and os.path.exists(p):
            with open(p, 'rb') as _f:
                return Response(_f.read(), mimetype='image/webp')

    # フォールバック: 録画TSのサムネ（保存済み WebP or ffmpeg リアルタイム生成）
    recording = db.get_recording(enc['recording_id'])
    if recording is None:
        abort(404)
    thumbnail_path = recording.get('thumbnail_path')
    if thumbnail_path and os.path.exists(thumbnail_path):
        with open(thumbnail_path, 'rb') as _f:
            return Response(_f.read(), mimetype='image/webp')
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='サムネイルが見つかりません')
    from media.probe.thumbnail_grab import get_thumbnail
    config = current_app.config['ENCODE_AUTO']
    data = get_thumbnail(config.get('ffmpeg', 'ffmpeg'), ts_path, timestamp_sec=5.0)
    if data is None:
        abort(500, description='サムネイル生成失敗')
    return Response(data, mimetype='image/jpeg')


@bp.post('/encode/recordings/<int:rec_id>/rescan')
def rescan_recording(rec_id):
    """error / waiting 状態の録画ファイルを pending に戻してTS再スキャンを促す。"""
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    if recording['state'] not in ('error', 'waiting', 'pending', 'scanning'):
        abort(400, description=f'state={recording["state"]} は再スキャンできません (error/waiting/pending のみ可)')

    # 中止マークを解除して再開できるようにする（中止したままだとワーカーが拾わない）
    db.update_recording(rec_id, state='pending', error_message=None, scan_cancelled=0)

    return jsonify({'id': rec_id, 'state': 'pending'})


@bp.post('/encode/recordings/<int:rec_id>/cancel_scan')
def cancel_scan_recording(rec_id):
    """実行中の解析(add_recording)を中止する。

    state は pending に戻すが scan_cancelled=1 を立てたままにして、録画の走査が
    そのまま再開しないようにする。再開は録画詳細の再スキャン（scan_cancelled をクリア）で行う。
    走査中のプロセスは節目ごとにこのフラグを見て自分で打ち切る（即座には止まらない）。
    """
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404, description='録画が見つかりません')
    if recording['state'] not in ('scanning', 'pending'):
        abort(400, description=f'state={recording["state"]} は中止できません (scanning/pending のみ可)')
    db.update_recording(rec_id, scan_cancelled=1,
                        **({'state': 'pending'} if recording['state'] == 'pending' else {}))
    return jsonify({'id': rec_id, 'cancelled': True})
