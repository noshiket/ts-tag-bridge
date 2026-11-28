"""結果の書き込み（CM の印・tag.json）・まとめて取り込み・コメントの取り直し"""

import asyncio
import json
import os
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from ..confirmed.tag import _video_tag_path  # noqa: F401
from ..tracks import (  # noqa: F401
    _update_video_json_cols,
)
from .jobs import _audio_sync_inputs, _audio_sync_opts  # noqa: F401
from .apply_ranges import _do_audio_compare_apply  # noqa: F401
from .records import _record_audio_sync  # noqa: F401


@bp.post('/videos/<int:video_id>/audio-compare/full')
async def audio_compare_full(video_id):
    """音声比較 → ずれの測定 → 映像の確認 → 取り込み まで一度に走らせる。

    全部で3分ほどかかるので、先に取り込む種別(captions/comments)を選んでもらってから
    後ろでまとめて流す。進捗は既存の /audio-compare/jobs/<id> で見る。

    body の audio_only を立てると音声比較だけで取り込む(40秒ほど)。ずれが 500ms 刻みの
    ままになる別方式で、コメント向け（字幕は 500ms ずれると致命的なので既定の方を使う）。
    """
    from logic import audio_compare

    db, tag_path, video, body, row, path_b, source = await _audio_sync_inputs(video_id)
    if os.path.realpath(path_b) == os.path.realpath(video['file_path']):
        abort(400, description='同じファイル同士は比較できません')
    if row is None:
        abort(400, description='取り込み元のデータ（字幕/コメント）が見つかりません')
    if not (body.get('captions') or body.get('comments')):
        abort(400, description='取り込む対象が選択されていません')
    source['name'] = audio_compare.track_name(row)
    from db.video_db.common import _has_announce
    source['announce'] = _has_announce(row.get('announce'))
    source['announce_self'] = _has_announce(video.get('announce'))

    opts = _audio_sync_opts(body, video, tag_path, row)

    def _apply(ranges, video_check, detail=None):
        # 取り込み時点の行を読み直す（解析中に他の取り込みが入っても壊さない）
        _tag, cur = _video_tag_path(db, video_id)
        added = _do_audio_compare_apply(
            db, video_id, _tag, cur, row,
            sorted(tuple(r) for r in ranges), body)
        _record_audio_sync(db, _tag, cur, row, source, detail or [], video_check, added,
                           method='audio_overlap' if body.get('audio_only') else None,
                           applied=ranges)
        return added

    cfg = current_app.config['ENCODE_AUTO']
    err, job_id = audio_compare.start_full(
        video_id, video['file_path'], path_b, source,
        cfg.get('ffmpeg', 'ffmpeg'), opts, _apply)
    if err == 'busy':
        abort(409, description='別の解析が実行中です（同時に1本まで）')
    return jsonify({'job_id': job_id})


@bp.post('/videos/<int:video_id>/comments/refetch')
async def video_comments_refetch(video_id):
    """実況コメントを取り直して主トラックを入れ替える（refetch_video_comments）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    r = await asyncio.to_thread(refetch_video_comments, db, video_id)
    if 'error' in r:
        abort(r['status'], description=r['error'])
    return jsonify(r)


def refetch_video_comments(db, video_id) -> dict:
    """動画の実況コメントを取り直して主トラックを入れ替える。

    録画直後の取得は過去ログAPIが追いついておらず末尾が数分ぶん欠けることがあるため、
    後から取り直せるようにする（画面のボタンと、コメントの取り直しのワーカーが使う）。
    件数が増えない時は入れ替えない（取りこぼしを増やさない）。後付けトラック（コメントを取り込むアドオンの物など）には手を付けない。
    戻り値: {'updated', 'before', 'after'}。取り直せない時は {'error', 'status'}
    """
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        return {'error': '動画が見つかりません', 'status': 404}
    if not video.get('sid'):
        return {'error': '放送局(sid)が分からないのでコメントを取れません', 'status': 400}
    try:
        segs = json.loads(video.get('trim_segments') or '[]')
    except (json.JSONDecodeError, TypeError):
        segs = []
    if not segs:
        return {'error': 'トリム区間が無いので放送時刻と対応が取れません', 'status': 400}

    from logic.encode_pipeline.tot_trim import _refetch_comments
    from logic.encode_pipeline.comment_trim import _trim_comments
    src = {'sid': video['sid'], 'comments_json': None}
    fetched = _refetch_comments(src, segs)
    if not fetched:
        return {'error': '実況の過去ログを取得できませんでした', 'status': 502}

    trimmed = _trim_comments(fetched, segs, video.get('recording_start_time'))
    new_list = json.loads(trimmed).get('comments') or []
    from logic.add_recording.comments import replace_main_comments
    cur, before = replace_main_comments(video.get('comments_json'), new_list)
    if cur is None:
        return {'updated': False, 'before': before, 'after': len(new_list)}

    _update_video_json_cols(db, video_id, tag_path,
                            {'comments_json': cur, 'comment_count': len(new_list)})
    return {'updated': True, 'before': before, 'after': len(new_list)}
