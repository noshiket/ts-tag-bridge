"""フレームの画像とフレーム表（/api/videos/<id>/frame, /frame_table）"""

import asyncio
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag, _save_tag


@bp.post('/videos/<int:video_id>/frame_table')
async def build_video_frame_table(video_id):
    """この動画のフレーム表を作って tag.json へ記録する（既存動画への後付け）。

    エンコード結果は可変フレームレートになることがあり、1/30秒ずつ動かす決め打ちでは
    コマ送りが合わない。実際のフレーム時刻を持たせるためのもの。
    ?force=1 で既にある場合も作り直す。
    """
    from media import mp4_frames
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    path = video.get('file_path') or ''
    if not path or not os.path.isfile(path):
        abort(404, description='動画ファイルが見つかりません')
    tag_path = path + '.tag.json'
    tag = _load_tag(tag_path)
    if tag is None:
        abort(400, description=f'tag.json が見つかりません: {tag_path}')
    if tag.get('frame_table') and request.args.get('force') != '1':
        return jsonify({'built': False, 'reason': 'already',
                        'summary': mp4_frames.summary(tag['frame_table'])})
    cfg = current_app.config['ENCODE_AUTO']
    table = await asyncio.to_thread(mp4_frames.build, path, cfg.get('ffprobe', 'ffprobe'))
    if not table:
        return jsonify({'built': False, 'reason': 'unsupported'}), 200
    tag['frame_table'] = table
    _save_tag(tag_path, tag)
    db.set_frame_table(video_id, table)   # 再生側は DB を見るので両方に入れる
    return jsonify({'built': True, 'summary': mp4_frames.summary(table),
                    'count': table['count']})


@bp.post('/videos/frame_table/backfill')
async def backfill_frame_tables():
    """フレーム表がまだ無い既存動画へまとめて追加する。

    body: {limit(任意・既定50), dry_run(任意)}
    エンコード時に作るようになったのは途中からなので、それ以前の動画への後付け用。
    1本あたり1秒未満(moovのサンプル表を読むだけ)だが、件数が多いので limit で刻む。
    """
    from media import mp4_frames
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await _json()
    limit = max(1, min(int(body.get('limit') or 50), 500))
    dry = bool(body.get('dry_run'))
    cfg = current_app.config['ENCODE_AUTO']
    ffprobe = cfg.get('ffprobe', 'ffprobe')

    # 1件ごとに tag.json の読み書きと DB 更新が入る。これをイベントループ上でやると
    # 数百件のあいだ他のリクエストが待たされて画面が開かなくなるため、丸ごと別スレッドで回す。
    def _run():
        done, skipped, failed = [], [], []
        # id と file_path だけの軽量な一覧を使う(表示用の list_videos は全件だと数分かかる)
        for v in db.iter_video_paths():
            if len(done) + len(failed) >= limit:
                break
            path = v.get('file_path') or ''
            if not path or not os.path.isfile(path):
                skipped.append({'id': v['id'], 'reason': 'ファイルなし'})
                continue
            tag_path = path + '.tag.json'
            tag = _load_tag(tag_path)
            if tag is None:
                skipped.append({'id': v['id'], 'reason': 'tag.jsonなし'})
                continue
            if tag.get('frame_table') and v.get('has_frame_table'):
                continue                  # tag.json と DB の両方にある分は対象外
            if dry:
                done.append({'id': v['id'], 'file': os.path.basename(path)})
                continue
            # tag.json に既にあれば作り直さず DB へ移すだけ(ffprobe を省ける)
            table = tag.get('frame_table')
            if not table:
                table = mp4_frames.build(path, ffprobe)
                if not table:
                    failed.append({'id': v['id'], 'file': os.path.basename(path)})
                    continue
                tag['frame_table'] = table
                try:
                    _save_tag(tag_path, tag)
                except Exception as e:
                    failed.append({'id': v['id'], 'error': str(e)[:120]})
                    continue
            try:
                db.set_frame_table(v['id'], table)
            except Exception as e:
                failed.append({'id': v['id'], 'error': f'DB更新に失敗: {str(e)[:100]}'})
                continue
            done.append({'id': v['id'], 'summary': mp4_frames.summary(table)})
        return done, skipped, failed

    done, skipped, failed = await asyncio.to_thread(_run)

    return jsonify({'built': len(done), 'failed': len(failed), 'skipped': len(skipped),
                    'dry_run': dry, 'details': done[:20], 'failures': failed[:20]})


@bp.get('/videos/<int:video_id>/frame_table')
def get_video_frame_table(video_id):
    """tag.json に記録したフレーム表を返す（無ければ 404）。"""
    from media import mp4_frames
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    tag = _load_tag((video.get('file_path') or '') + '.tag.json') or {}
    table = tag.get('frame_table')
    if not table:
        abort(404, description='フレーム表がありません')
    return jsonify({'table': table, 'summary': mp4_frames.summary(table),
                    'count': table.get('count')})


