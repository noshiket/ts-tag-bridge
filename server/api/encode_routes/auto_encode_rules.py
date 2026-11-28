"""自動エンコードの登録（/api/auto_encode の一覧・追加・変更・削除）"""

from quart import jsonify, abort
from api.routes.auth import bp
from api.routes.rec_aug_rows import _cv_str
from api.routes.caches import _json
from api.routes.parser import _ruledb


_AUTO_ENCODE_FLAGS = (
    'use_folder', 'use_title', 'use_sid',
    'require_episode_name', 'require_episode_number',
    'allow_multi_episode', 'enabled',
)


@bp.get('/auto_encode')
def list_auto_encode_rules():
    """自動エンコードのルール（確定値に合う録画をエンコードへ回す）の一覧。"""
    return jsonify(_ruledb().list_auto_encode())


@bp.post('/auto_encode')
async def add_auto_encode_rule():
    """auto_encode ルールを追加する。

    recording_id（recordings.id）を渡すと folder/title/sid を確定値から
    スナップショットする。body に folder/title/sid を直接指定した場合はそちらを優先。
    フラグ: use_folder/use_title/use_sid/require_episode_name/
    require_episode_number/allow_multi_episode/enabled。
    """
    body = await _json()
    db = _ruledb()
    snap = {}
    rid = body.get('recording_id')
    if rid is not None:
        rec = db.get_recording(rid)
        if rec is None:
            abort(404, description='録画が見つかりません')
        # auto_encodes は文字列列。確定値が list の場合は正規化して保存する。
        snap = {'folder': _cv_str(rec.get('folder')), 'title': _cv_str(rec.get('title')), 'sid': rec.get('sid')}
    fields = {
        'folder': body.get('folder', snap.get('folder')),
        'title':  body.get('title',  snap.get('title')),
        'sid':    body.get('sid',    snap.get('sid')),
    }
    for k in _AUTO_ENCODE_FLAGS:
        if k in body:
            fields[k] = 1 if body[k] else 0
    ae_id = db.add_auto_encode(**fields)
    return jsonify(db.get_auto_encode(ae_id)), 201


@bp.patch('/auto_encode/<int:ae_id>')
async def update_auto_encode_rule(ae_id):
    """自動エンコードのルールを変える。body: folder・title・sid と、各フラグ。"""
    body = await _json()
    db = _ruledb()
    if db.get_auto_encode(ae_id) is None:
        abort(404, description='ルールが見つかりません')
    fields = {}
    for k in ('folder', 'title', 'sid'):
        if k in body:
            fields[k] = body[k]
    for k in _AUTO_ENCODE_FLAGS:
        if k in body:
            fields[k] = 1 if body[k] else 0
    db.update_auto_encode(ae_id, **fields)
    return jsonify(db.get_auto_encode(ae_id))


@bp.delete('/auto_encode/<int:ae_id>')
def delete_auto_encode_rule(ae_id):
    """自動エンコードのルールを消す。"""
    db = _ruledb()
    if db.get_auto_encode(ae_id) is None:
        abort(404, description='ルールが見つかりません')
    db.delete_auto_encode(ae_id)
    return jsonify({'deleted': ae_id})
