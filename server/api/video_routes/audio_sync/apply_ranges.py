"""解析した時間の対応で字幕・コメントを取り込む"""

import json
from datetime import datetime
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.media import _caption3_tracks, _parse_captions_data
from api.routes.caches import _json
from ..confirmed.compare_candidates import _audio_compare_source_row
from ..confirmed.tag import _video_tag_path
from ..tracks import _update_video_json_cols
from .records import _record_audio_sync


def _do_audio_compare_apply(db, video_id, tag_path, video, row, ranges, body):
    """取り込みの実処理。時間対応(ranges)で字幕/コメントを付け替えて書き込む。

    ルート(audio_compare_apply)と、比較から取り込みまで一度に流すジョブの
    両方から呼ぶ。入力が不正なら ValueError を投げる(呼び出し側が 400 にする)。
    戻り: added {captions?:{name,count}, comments?:{name,count}}
    """
    from logic import audio_compare
    fields = {}
    added = {}
    skipped = {}          # 取り込むものが無かった種別（片方だけなら失敗にしない）

    # ── 字幕: captions3_json（後付け字幕の名前付きトラック） ──
    cap_req = body.get('captions')
    # 片方に取り込むものが無いだけで全体を失敗させない（もう片方は取り込む）
    moved = (audio_compare.remap_captions(
        _parse_captions_data(row.get('captions_json')), ranges,
        video.get('duration_sec')) if cap_req else [])
    if cap_req and not moved:
        skipped['captions'] = '共通区間内に字幕がありません'
        cap_req = None
    if cap_req:
        tracks = _caption3_tracks(video.get('captions3_json'))
        if cap_req.get('mode') == 'append':
            idx = int(cap_req.get('index', -1))
            if not (0 <= idx < len(tracks)):
                raise ValueError('追記先の字幕トラックがありません')
            merged = tracks[idx]['captions'] + moved
            merged.sort(key=lambda c: c.get('pts', 0))
            tracks[idx]['captions'] = merged
            added['captions'] = {'name': tracks[idx].get('name'), 'count': len(moved)}
        else:
            name = audio_compare.unique_name(
                (cap_req.get('name') or audio_compare.track_name(row)).strip(),
                [t.get('name') for t in tracks])
            tracks.append({
                'name': name,
                'source': {'video_id': row.get('id'), 'path': row.get('file_path'),
                           'recording_start_time': row.get('recording_start_time')},
                'created_at': datetime.now().isoformat(),
                'captions': moved,
            })
            added['captions'] = {'name': name, 'count': len(moved)}
        fields['captions3_json'] = tracks

    # ── コメント: comments_json のトップレベルへ名前付きトラックを足す ──
    cmt_req = body.get('comments')
    try:
        src_all = json.loads(row.get('comments_json') or '{}') if cmt_req else {}
    except (json.JSONDecodeError, TypeError):
        src_all = {}
    src_list = src_all.get('comments') if isinstance(src_all, dict) else src_all
    moved = (audio_compare.remap_comments(
        src_list, ranges, video.get('duration_sec')) if cmt_req else [])
    if cmt_req and not moved:
        skipped['comments'] = '共通区間内にコメントがありません'
        cmt_req = None
    if cmt_req:
        try:
            cur = json.loads(video.get('comments_json') or '{}')
        except (json.JSONDecodeError, TypeError):
            cur = {}
        if not isinstance(cur, dict):
            cur = {'comments': cur if isinstance(cur, list) else []}
        cur.setdefault('comments', [])
        if cmt_req.get('mode') == 'append':
            key = cmt_req.get('key') or 'comments'
            if not isinstance(cur.get(key), list):
                raise ValueError('追記先のコメントトラックがありません')
            merged = cur[key] + moved
            merged.sort(key=lambda c: c.get('time', 0))
            cur[key] = merged
            added['comments'] = {'name': key, 'count': len(moved)}
        else:
            name = audio_compare.unique_name(
                (cmt_req.get('name') or audio_compare.track_name(row)).strip(),
                [k for k, v in cur.items() if isinstance(v, list)])
            cur[name] = moved
            added['comments'] = {'name': name, 'count': len(moved)}
        fields['comments_json'] = cur
        # comment_count は主トラック comments の件数のみ（既存ルールを維持）
        fields['comment_count'] = len(cur.get('comments') or [])

    if not fields:
        raise ValueError('取り込めるものがありませんでした（'
                         + ' / '.join(skipped.values()) + '）'
                         if skipped else '取り込む対象が選択されていません')
    _update_video_json_cols(db, video_id, tag_path, fields)
    if skipped:
        added['skipped'] = skipped
    return added


@bp.post('/videos/<int:video_id>/audio-compare/apply')
async def audio_compare_apply(video_id):
    """解析結果の時間対応で、取り込み元の字幕/コメントをこの動画へ追加する。

    body: {matches, source, captions:{mode,name?,index?}|null, comments:{mode,name?,key?}|null}
      mode: 'new'=新規トラック / 'append'=既存トラックへ追記
    """
    from logic import audio_compare

    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    tag_path, video = _video_tag_path(db, video_id)
    if video is None:
        abort(404, description='動画が見つかりません')

    body = await _json()
    # frame-sync 済みならその区間を使う（音声比較のままだと最大数フレームずれる）。
    # 形は build_ranges と同じ (b_start, b_end, offset)。
    ranges = [tuple(r) for r in (body.get('ranges') or []) if len(r) == 3]
    ranges = sorted(ranges) or audio_compare.build_ranges(body.get('matches'))
    if not ranges:
        abort(400, description='共通区間がありません')
    row, _path, _src = _audio_compare_source_row(db, body.get('source') or {})
    if row is None:
        abort(400, description='取り込み元のデータ（字幕/コメント）が見つかりません')

    try:
        added = _do_audio_compare_apply(db, video_id, tag_path, video, row, ranges, body)
    except ValueError as e:
        abort(400, description=str(e))
    # 前回の解析結果を流用した場合(detail 付き)は、その対応も記録に残す
    detail = body.get('detail')
    if detail:
        # 求め方は流用元の記録のもの。ここで既定にすると、音声比較(500ms刻み)で
        # 取った対応まで「音声をサンプル単位で突き合わせた」ことになってしまう
        _record_audio_sync(db, tag_path, video, row, body.get('source') or {},
                           detail, body.get('video_check') or [], added, reused=True,
                           method=body.get('method'), applied=ranges)
    return jsonify({'applied': True, 'added': added})
