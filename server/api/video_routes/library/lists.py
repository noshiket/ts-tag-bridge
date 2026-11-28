"""一覧・カテゴリ・シリーズの移動・手動追加の既定値"""

import json
import os
from quart import (
    jsonify,
    current_app,
    request,
    abort,
)
from api.routes.auth import bp, perm, private_cats  # noqa: F401
from api.routes.tag_io import logger  # noqa: F401
from .perms import _perm_prune_videos  # noqa: F401


@bp.get('/videos/list')
def get_video_list():
    """全動画のフラット一覧(album横断・ページング)。ライブラリの「ビデオ」表示用。
    from/to(YYYY-MM-DD)で放送日を範囲絞込、q でタイトル絞込、sort/dir で並び替え。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    result = db.list_videos(
        page=request.args.get('page', default=0, type=int),
        per_page=request.args.get('per_page', default=30, type=int),
        sort=request.args.get('sort', 'broadcast'),
        sort_dir=request.args.get('dir', 'desc'),
        date_from=request.args.get('from') or None,
        date_to=request.args.get('to') or None,
        text=request.args.get('q') or None,
        # dir は並び順(asc/desc)で使っているため、保存先ディレクトリは dir_root で受ける
        dir_root=request.args.get('dir_root') or None,
        perm_conds=perm().video_conds(),
        private_categories=private_cats(),
        # 音楽はミュージックタブで見る（?media_kind=audio で音楽だけ）
        media_kind=request.args.get('media_kind') or 'video',
    )
    return jsonify(result)


@bp.get('/videos/categories')
def list_video_categories():
    """カテゴリ一覧（id / 名前 / 紐づく本数）。権限設定のNGカテゴリ選択に使う。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify([])
    rows = db._get_conn().execute("""
        SELECT c.id, c.name, COUNT(cn.id) AS node_count
        FROM categories c LEFT JOIN category_nodes cn ON cn.category_id = c.id
        GROUP BY c.id ORDER BY c.name
    """).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.get('/videos/categories/<int:category_id>')
def get_video_category_detail(category_id):
    """カテゴリに実効的に属する動画一覧（album横断）。"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    if not perm().category(category_id):
        abort(403, description='このカテゴリは許可されていません')
    detail = db.get_category_videos(category_id, private_categories=private_cats())
    if detail is None:
        abort(404)
    return jsonify(_perm_prune_videos(detail))


@bp.put('/videos/albums/<int:album_id>/series/<int:series_id>/move')
async def move_video_series(album_id, series_id):
    """album内でのseries表示順(sort_order)を移動する。
    body: {direction: 'up'|'down'}（隣接swap）または
          {ref_id: <series_id>, place: 'before'|'after'}（任意位置へ挿入。D&D/長押し移動用）"""
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    body = await request.get_json(silent=True) or {}
    if body.get('ref_id') is not None:
        place = body.get('place')
        if place not in ('before', 'after'):
            abort(400, description='place は before/after のいずれかを指定してください')
        moved = db.move_series_relative(album_id, series_id, int(body['ref_id']), place)
        return jsonify({'moved': moved})
    direction = body.get('direction')
    if direction not in ('up', 'down'):
        abort(400, description='direction は up/down のいずれかを指定してください')
    moved = db.move_series(album_id, series_id, direction)
    return jsonify({'moved': moved})


@bp.post('/videos/<int:video_id>/addons/<name>/run')
async def run_video_addon(video_id, name):
    """videoアドオンをバックグラウンド実行する。body=アドオンparams。{job_id}を返す。

    ADDON['encode_queue'] を立てているアドオンは、その場で走らせずに
    エンコードキュー(encodings)へ1行積む。QSV を使う重い変換を、録画の
    エンコードと同じ行列で1件ずつ流すため（別々に走らせると食い合う）。
    """
    from logic.addons import addon_runner
    params = await request.get_json(silent=True) or {}

    sch = next((a for a in addon_runner.list_addons(target='video')
                if a.get('name') == name), None)
    if sch and sch.get('encode_queue'):
        rule_db = current_app.config.get('RULE_DB')
        video_db = current_app.config.get('VIDEO_DB')
        v = video_db.get_video_row(video_id) if video_db else None
        if v is None:
            abort(404, description='動画が見つかりません')
        dup = rule_db.find_pending_video_addon(name, video_id) if rule_db else None
        if dup:
            return jsonify({'enc_id': dup['id'], 'queued': True, 'already': True})
        enc_id = rule_db.add_encoding(
            0, order_index=0, state='wait_encode',
            job_kind='video_addon', video_id=video_id, addon_name=name,
            addon_params=json.dumps(params, ensure_ascii=False),
            title=(v.get('eit_title') or os.path.basename(v.get('file_path') or ''))[:200],
            # 優先度は録画のエンコードと同じ既定(3)。下げると必ず後回しになり、
            # 「積んだ順に流れる」という見え方から外れる
            folder=v.get('folder') or '', priority=3)
        logger.info('run_video_addon: %s を video=%d でキューへ積みました (enc=%d)',
                    name, video_id, enc_id)
        return jsonify({'enc_id': enc_id, 'queued': True})

    err, job_id = addon_runner.start_addon(
        name, video_id, params,
        config=current_app.config['ENCODE_AUTO'],
        video_db=current_app.config.get('VIDEO_DB'),
        rule_db=current_app.config.get('RULE_DB'),
        users_db=current_app.config.get('USERS_DB'))
    if err == 'video_not_found':
        abort(404, description='動画が見つかりません')
    if err == 'not_found':
        abort(404, description=f'アドオン {name} が見つかりません')
    if err == 'busy':
        abort(409, description='この動画で別のアドオンが実行中です')
    return jsonify({'job_id': job_id}), 202


@bp.get('/videos/private_hidden')
def video_private_hidden():
    """指定 id のうち、プライベートカテゴリのため隠している動画の id を返す。

    「続きを見る」「ローカル保存」の一覧は、カードが返らない id を「消えた(=別idへ
    張り替える)」と解釈する。隠しているだけの動画と区別できないと、非公開のはずの
    エントリが題名付きで残り、他サーバーまで探しに行ってしまうため、ここで見分ける。
    プライベートモード(?private=1)では何も隠さないので空を返す。
    """
    db = current_app.config.get('VIDEO_DB')
    ids = [int(x) for x in (request.args.get('ids') or '').split(',') if x.strip().isdigit()]
    priv = private_cats()
    if db is None or not ids or not priv:
        return jsonify([])
    hidden = set(db.private_video_ids(priv))
    return jsonify(sorted(i for i in ids[:200] if i in hidden))


