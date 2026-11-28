"""録画のチャプター・CM 解析・フレーム表・アドオン"""

import asyncio
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api import schemas
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401


@bp.post('/encode/recordings/<int:db_rec_id>/chapters')
async def preview_recording_chapters(db_rec_id):
    """segments からこの録画のチャプターを導出して返す（分割画面のプレビュー用）。

    body: {segments: ["HH:MM:SS.mmm-HH:MM:SS.mmm,keep(..)...", ...]}
      省略すると DB に保存済みの segments を使う。
    返り値: {chapters: [[{start,end,name,label,keep_index}, ...], ...]}（話ごと）

    エンコード時に書く chapter.txt と同じ導出（logic.encode_pipeline）なので、
    ここに出るものがそのまま成果物のチャプターになる。
    """
    import json as _j
    from logic.encode_pipeline.trim.avs import _parse_trim_mode_segments, parse_chapter_names
    from logic.encode_pipeline.trim.chapters import chapters_from_trim

    db = _ruledb()
    rec = db.get_recording(db_rec_id)
    if rec is None:
        abort(404)
    body = await _json()
    segs = body.get('segments')
    if segs is None:
        segs = rec.get('segments')
        if isinstance(segs, str):
            try:
                segs = _j.loads(segs)
            except (ValueError, TypeError):
                segs = []
    if not isinstance(segs, list):
        abort(400, description='segments は配列で指定してください')
    # 話の添字を保つため、対象外のスロット(余り)は null で来る。その話は空で返す

    raw = rec.get('cm_analysis')
    jls = []
    if raw:
        try:
            jls = _j.loads(raw).get('jls_segments') or []
        except (ValueError, TypeError):
            jls = []
    out = []
    for seg in segs:
        spec = _parse_trim_mode_segments(seg) if isinstance(seg, str) else None
        out.append(chapters_from_trim(spec, jls, parse_chapter_names(seg)) if spec else [])
    return jsonify({'chapters': out})


@bp.post('/encode/recordings/<int:db_rec_id>/frame_table')
async def build_recording_frame_table(db_rec_id):
    """録画TSのフレーム表を作って recordings.frame_table に記録する（後付け）。

    MPEG-2 は media/frame_index.py が Amatsukaze の Trim(n) と一致する厳密な表を作れる
    (カットにも使う)のでそちらに任せ、自前パーサが対応していない H.264/H.265 のときだけ
    ffprobe で作る。用途は表示・コマ送り・シークのみでカットには使わない。
    ?force=1 で作り直す。
    """
    import json as _j
    from media import mp4_frames
    db = _ruledb()
    rec = db.get_recording(db_rec_id)
    if rec is None:
        abort(404)
    ts_path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
    if not ts_path or not os.path.isfile(ts_path):
        abort(404, description='TSファイルが見つかりません')
    if rec.get('frame_table') and request.args.get('force') != '1':
        try:
            return jsonify({'built': False, 'reason': 'already',
                            'summary': mp4_frames.summary(_j.loads(rec['frame_table']))})
        except Exception:
            pass
    codec = None
    if rec.get('probe_result'):
        try:
            codec = (_j.loads(rec['probe_result']).get('video') or {}).get('codec')
        except Exception:
            codec = None
    if codec not in ('h264', 'hevc', 'h265'):
        return jsonify({'built': False, 'reason': 'mpeg2',
                        'note': 'MPEG-2 は frame_index(厳密な表)を使うため対象外です',
                        'codec': codec}), 200
    cfg = current_app.config['ENCODE_AUTO']
    table = await asyncio.to_thread(mp4_frames.build, ts_path, cfg.get('ffprobe', 'ffprobe'))
    if not table:
        return jsonify({'built': False, 'reason': 'unsupported'}), 200
    db.update_recording(db_rec_id, frame_table=_j.dumps(table, ensure_ascii=False))
    return jsonify({'built': True, 'codec': codec, 'count': table['count'],
                    'summary': mp4_frames.summary(table)})


@bp.get('/rules')
def list_rules():
    """予約ごとの解析の記録（ルール）の一覧。?state= で絞る。"""
    state = request.args.get('state')
    rules = _ruledb().list_rules(state=state)
    # 利用者ごとの権限（局・有料の番組）で絞る（1件を開く口は record_guard が断る）
    from api.routes.auth import perm
    from api.routes.record_guard import rule_visible
    p = perm()
    if not p.is_admin:
        rules = [r for r in rules if rule_visible(p, r)]
    return jsonify([schemas.rule_to_response(r) for r in rules])
