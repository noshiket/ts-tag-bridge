"""接続先の選び方・キュー・ログ"""

from quart import jsonify, current_app, request, abort
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _amz, _amz_remove_amt_dir  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from .amz_call import _amz_for, _amz_call  # noqa: F401


def _amz_volumes(url: str) -> list:
    """指定 Amatsukaze サーバーの volumes（コンテナ→ホストのパス変換表）。

    url 未指定は既定サーバー。_resolve_encode_context と同じ選び方に揃える。
    """
    cfg = current_app.config.get('ENCODE_AUTO') or {}
    servers = cfg.get('amatsukaze_servers') or []
    target = (url or '').rstrip('/')
    amz_cfg = next((s for s in servers if (s.get('url') or '').rstrip('/') == target),
                   servers[0] if servers else {})
    return amz_cfg.get('volumes', [])


def _amz_item_amt_dir(client, url: str, item_id: int):
    """キューアイテムの作業フォルダ(amt*)をログから引く。取れなければ None。

    Amatsukaze はエンコードログに「一時フォルダ: …」を出すので、そこから拾う。
    未開始のアイテムには encodeStart が無いので None（消すものも無い）。
    """
    from logic.encode_pipeline.amatsukaze.amt_dir import get_amt_dir
    try:
        q = client.get_queue()
        item = next((it for it in (q.get('items') or []) if it.get('id') == item_id), None)
        if item is None:
            return None
        return get_amt_dir(client, item, _amz_volumes(url))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning('amz: get_amt_dir(item=%s) failed: %s', item_id, e)
        return None


# --- Queue ---

@bp.get('/amatsukaze/queue')
def amz_get_queue():
    """Amatsukaze のキュー。?url= で別の Amatsukaze サーバー、?state=（複数可）・search・searchTargets・dateFrom・dateTo・hideOneSeg で絞る。"""
    # ?url= で対象サーバーを指定できる（設定画面がサーバーごとに引くため）
    amz = _amz_for(request.args.get('url'))
    state = request.args.getlist('state') or None
    result = _amz_call(
        amz.get_queue,
        state=state,
        search=request.args.get('search'),
        search_targets=request.args.get('searchTargets'),
        date_from=request.args.get('dateFrom'),
        date_to=request.args.get('dateTo'),
        hide_one_seg=request.args.get('hideOneSeg', type=lambda v: v.lower() == 'true'),
    )
    return jsonify(result)


@bp.get('/amatsukaze/queue/changes')
def amz_queue_changes():
    """Amatsukaze のキューの変化のうち、?since=（必須）より後の分を返す（画面の追従用）。"""
    since = request.args.get('since', type=int)
    if since is None:
        abort(400, description='since parameter required')
    return jsonify(_amz_call(_amz().get_queue_changes, since))


@bp.get('/amatsukaze/messages/changes')
def amz_message_changes():
    """Amatsukaze の知らせ（メッセージ）のうち、?since=（必須）より後の分を返す。?page・requestId・levels・max（50）で絞る。"""
    since = request.args.get('since', type=int)
    if since is None:
        abort(400, description='since parameter required')
    return jsonify(_amz_call(
        _amz().get_message_changes,
        since,
        page=request.args.get('page'),
        request_id=request.args.get('requestId'),
        levels=request.args.get('levels'),
        max=request.args.get('max', default=50, type=int),
    ))


@bp.post('/amatsukaze/queue/add')
async def amz_add_queue():
    """Amatsukaze のキューへ足す。body: {dirPath, targets, mode?（Batch 既定）, outputs, requestId?, addQueueBat?}。"""
    body = await _json()
    result = _amz_call(
        _amz().add_queue,
        dir_path=body.get('dirPath'),
        targets=body.get('targets'),
        mode=body.get('mode', 'Batch'),
        outputs=body.get('outputs'),
        request_id=body.get('requestId'),
        add_queue_bat=body.get('addQueueBat'),
    )
    return jsonify(result)


@bp.post('/amatsukaze/queue/change')
async def amz_change_queue():
    """Amatsukaze のキューの項目を操作する（取り消し・やり直し・優先度・プロファイルの変更・削除など）。

    body: {itemId, changeType, workerId?, priority?, profile?, mode?, position?, requestId?, url?}。
    changeType が RemoveItem の時は、残る作業フォルダ（amt*）も消し、消した場所を removed_amt_dir で返す。
    """
    body = await _json()
    client = _amz_for(body.get('url'))
    change_type = body['changeType']
    # RemoveItem はキューから消えるだけで作業フォルダ(amt*)が残る。消えたあとはログから
    # 辿れなくなるので、消す前にパスを控えておく（実測で /tmp に 31GB 溜まっていた）。
    amt_dir = (_amz_item_amt_dir(client, body.get('url'), body['itemId'])
               if change_type == 'RemoveItem' else None)
    result = _amz_call(
        client.change_queue,
        body['itemId'],
        change_type,
        worker_id=body.get('workerId', 0),
        priority=body.get('priority', 0),
        profile=body.get('profile'),
        mode=body.get('mode'),
        position=body.get('position', 0),
        request_id=body.get('requestId'),
    )
    removed_amt_dir = _amz_remove_amt_dir(amt_dir)
    return jsonify({**result, 'removed_amt_dir': removed_amt_dir} if isinstance(result, dict)
                   else result)


@bp.post('/amatsukaze/queue/move-many')
async def amz_move_queue_many():
    """Amatsukaze のキューの項目をまとめて並べ替える。body: {itemIds, dropIndex, requestId?}。"""
    body = await _json()
    result = _amz_call(
        _amz().move_queue_many,
        body['itemIds'],
        body['dropIndex'],
        request_id=body.get('requestId'),
    )
    return jsonify(result)


@bp.post('/amatsukaze/queue/pause')
async def amz_pause_queue():
    """Amatsukaze のキューを止める・動かす。body: {pause, isQueue?, index?}。"""
    body = await _json()
    result = _amz_call(
        _amz().pause_queue,
        body['pause'],
        is_queue=body.get('isQueue', True),
        index=body.get('index', 0),
    )
    return jsonify(result)


