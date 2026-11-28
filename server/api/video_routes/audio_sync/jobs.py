"""音声比較・ずれの測り直しの開始とジョブの一覧"""

import json
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _parse_captions_data
from api.routes.caches import _json  # noqa: F401
from ..confirmed.compare_candidates import _audio_compare_source_row  # noqa: F401
from ..confirmed.tag import _video_tag_path  # noqa: F401
from .records import _cm_marks_for_video
from logic.encoding import load_weights


@bp.post('/videos/<int:video_id>/audio-compare')
async def audio_compare_start(video_id):
    """音声比較をバックグラウンドで開始する。body: {video_id|recording_id|path, ...opts}"""
    from logic import audio_compare

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None or not video.get('file_path') or not os.path.exists(video['file_path']):
        abort(404, description='動画ファイルが見つかりません')

    body = await _json()
    row, path_b, source = _audio_compare_source_row(db, body)
    if not path_b:
        abort(400, description='比較相手を指定してください')
    if not os.path.exists(path_b):
        abort(404, description=f'比較相手のファイルが見つかりません: {path_b}')
    if os.path.realpath(path_b) == os.path.realpath(video['file_path']):
        abort(400, description='同じファイル同士は比較できません')
    if row is not None:
        source['name'] = audio_compare.track_name(row)
        # 取り込める種別をクライアントへ伝える（無い種別の選択肢を出さないため）
        source['has_captions'] = len(_parse_captions_data(row.get('captions_json'))) > 0
        try:
            src_cmt = json.loads(row.get('comments_json') or '{}')
        except (json.JSONDecodeError, TypeError):
            src_cmt = {}
        cmt_list = src_cmt.get('comments') if isinstance(src_cmt, dict) else src_cmt
        source['comment_count'] = len(cmt_list) if isinstance(cmt_list, list) else 0

    cfg = current_app.config['ENCODE_AUTO']
    err, job_id = audio_compare.start(
        video_id, video['file_path'], path_b, source, cfg.get('ffmpeg', 'ffmpeg'), body)
    if err == 'busy':
        abort(409, description='別の音声比較が実行中です（同時に1本まで）')
    return jsonify({'job_id': job_id})


async def _audio_sync_inputs(video_id):
    """ずれの測り直し・まとめて取り込みで共通の入力。動画と比べる相手を取り出す。

    戻り: (db, tag_path, video, body, row, path_b, source)。無ければ 404 / 400 で止める。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None or not video.get('file_path') or not os.path.exists(video['file_path']):
        abort(404, description='動画ファイルが見つかりません')

    body = await _json()
    row, path_b, source = _audio_compare_source_row(db, body)
    if not path_b or not os.path.exists(path_b):
        abort(400, description='比較相手のファイルが見つかりません')
    return db, tag_path, video, body, row, path_b, source


def _audio_sync_opts(body, video, tag_path, row) -> dict:
    """ずれの測り直し・まとめて取り込みで共通の判定の設定（body に足して返す）。"""
    opts = dict(body)
    try:
        opts['trim_segments'] = json.loads(video.get('trim_segments') or '[]')
    except (json.JSONDecodeError, TypeError):
        opts['trim_segments'] = []
    # CM解析の無音＋場面の切り替わりから来ているチャプター位置。判定点に使う。
    # 無ければ解析して tag.json へ残す（解析はジョブの中で走らせる）
    opts['chapter_txt'] = video.get('chapter_txt') or ''
    opts['marks_fn'] = lambda log: _cm_marks_for_video(video, tag_path, on_log=log)
    # 相手側のチャプター位置。A と B の境界を重ねて細かい方で判定の単位を割る
    from logic import frame_sync as _fsync
    opts['bounds_b'] = _fsync.chapter_marks(row.get('chapter_txt')) if row else []
    # 急がない処理なので優先度を下げ、負荷が高い間は待つ。CM解析(nice=10)と
    # 時間帯が重なっても食い合わないようにする
    cfg0 = current_app.config['ENCODE_AUTO']
    opts.update(load_weights.audio_sync_params(cfg0))   # 設定の重さ（控えめ・ふつう・全力）
    return opts


@bp.post('/videos/<int:video_id>/frame-sync')
async def frame_sync_start(video_id):
    """音声比較の結果を受け取り、ずれをサンプル単位まで測り直す。

    body: {matches, video_id|recording_id|path, verify_video?}
    音声比較は 500ms(refine しても 125ms)刻みなので、そのまま取り込むと字幕が
    最大で数フレームずれる。実測では「ずれ0」と報告された2本の真のずれが
    最大 151.6ms(4.5フレーム)あった。
    """
    from logic import audio_compare

    db, tag_path, video, body, row, path_b, source = await _audio_sync_inputs(video_id)
    if row is not None:
        source['name'] = audio_compare.track_name(row)
    # 放送異常告知(しょぼいカレンダー)がある動画は L字テロップ等で画面が動いている
    # 可能性がある。映像の判定は L字でも効くが、結果が微妙なときの手掛かりになるので
    # 双方の告知の有無を返す
    from db.video_db.common import _has_announce
    source['announce'] = _has_announce(row.get('announce')) if row else False
    source['announce_self'] = _has_announce(video.get('announce'))

    # チャプター区間の端は必ず場面の切り替わりなので、映像判定の位置に使う
    opts = _audio_sync_opts(body, video, tag_path, row)

    cfg = current_app.config['ENCODE_AUTO']
    err, job_id = audio_compare.start_frame_sync(
        video_id, video['file_path'], path_b, source, body.get('matches'),
        cfg.get('ffmpeg', 'ffmpeg'), opts)
    if err == 'busy':
        abort(409, description='別の解析が実行中です（同時に1本まで）')
    if err == 'nomatch':
        abort(400, description='共通区間がありません（先に音声を比較してください）')
    return jsonify({'job_id': job_id})


@bp.get('/audio-compare/queue')
def audio_compare_queue():
    """音声解析の一覧（実行中・順番待ち・直近の完了）。設定＞アプリ に出す。"""
    from logic import audio_compare
    db = current_app.config.get('VIDEO_DB')
    jobs = audio_compare.list_jobs()
    # どの動画かが分かるよう題名を添える
    for j in jobs:
        row = db.get_video_row(j['video_id']) if db and j.get('video_id') else None
        j['title'] = (row or {}).get('eit_title') or ''
        j['episode_number'] = (row or {}).get('episode_number')
    return jsonify({'jobs': jobs})


@bp.post('/audio-compare/queue/<job_id>/cancel')
def audio_compare_queue_cancel(job_id):
    """順番待ちの解析を取り消す（実行中のものは止められない）。"""
    from logic import audio_compare
    if not audio_compare.cancel_job(job_id):
        abort(400, description='順番待ちにありません（実行中か、既に終わっています）')
    return jsonify({'cancelled': True})


@bp.get('/audio-compare/current')
def audio_compare_current():
    """この動画で実行中の解析ジョブを返す（無ければ直近の1件、それも無ければ null）。

    job_id は画面の状態にしか無いので、ページを読み込み直すと解析中でも追えなくなる。
    動画を開いた時にこれで拾い直す。
    """
    from logic import audio_compare
    try:
        video_id = int(request.args.get('video_id', ''))
    except (TypeError, ValueError):
        video_id = None
    return jsonify({'job': audio_compare.current_job(video_id)})


@bp.get('/audio-compare/jobs/<job_id>')
def audio_compare_job(job_id):
    """音声比較ジョブの進捗/結果を返す。"""
    from logic import audio_compare
    job = audio_compare.get_job(job_id)
    if job is None:
        abort(404, description='ジョブが見つかりません')
    return jsonify(job)


