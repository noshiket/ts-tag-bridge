"""利用者の管理（承認・権限・削除）"""

from quart import current_app, jsonify, request
from .auth import (  # noqa: F401
    auth_bp,
    current_user,
)


# ── 管理者 API ──────────────────────────────────────────────────────────

@auth_bp.patch('/api/admin/users/<int:user_id>/status')
async def admin_set_user_status(user_id):
    """利用者の承認状態を変える（管理者のみ）。body: {status: approved|rejected|pending}"""
    me = current_user()
    if not me:
        return jsonify({'error': 'Unauthorized'}), 401
    if not me.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    if me['id'] == user_id:
        return jsonify({'error': '自分自身の状態は変えられません'}), 400
    body = await request.get_json() or {}
    status = (body.get('status') or '').strip()
    db = current_app.config['USERS_DB']
    try:
        ok = db.set_user_status(user_id, status)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    if not ok:
        return jsonify({'error': 'ユーザーが見つかりません'}), 404
    return jsonify(db.get_user(user_id))


@auth_bp.patch('/api/admin/users/<int:user_id>/admin')
async def admin_set_user_admin(user_id):
    """利用者を管理者にする・外す（管理者のみ）。body: {is_admin: bool}。

    自分自身は外せない（最後の管理者を外して、誰も設定を触れなくなるのを防ぐ。外す時は別の管理者が外す）。
    管理者にできるのは承認済みの利用者だけ。
    """
    me = current_user()
    if not me:
        return jsonify({'error': 'Unauthorized'}), 401
    if not me.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    if me['id'] == user_id:
        return jsonify({'error': '自分自身の管理者の権限は変えられません（ほかの管理者に頼んでください）'}), 400
    body = await request.get_json() or {}
    if not isinstance(body.get('is_admin'), bool):
        return jsonify({'error': 'is_admin（true / false）が要ります'}), 400
    db = current_app.config['USERS_DB']
    user = db.get_user(user_id)
    if not user:
        return jsonify({'error': 'ユーザーが見つかりません'}), 404
    if body['is_admin'] and (user.get('status') or 'approved') != 'approved':
        return jsonify({'error': '承認していない利用者は管理者にできません'}), 400
    db.set_admin(user_id, body['is_admin'])
    return jsonify(db.get_user(user_id))


@auth_bp.get('/api/admin/users/<int:user_id>/perms')
async def admin_get_user_perms(user_id):
    """利用者の権限（見られる画面・書き込めるか・局の絞り込みなど）。管理者だけ。"""
    me_ = current_user()
    if not me_:
        return jsonify({'error': 'Unauthorized'}), 401
    if not me_.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    return jsonify(current_app.config['USERS_DB'].get_perms(user_id))


@auth_bp.patch('/api/admin/users/<int:user_id>/perms')
async def admin_update_user_perms(user_id):
    """アクセス権を設定する（管理者のみ）。

    body: {screens:[], nodes:[], stations:[], deny_categories:[], guides:[], can_write:bool, paid:bool}
    リストは許可リスト（['*'] で全部）。deny_categories だけは NG リスト。
    """
    me_ = current_user()
    if not me_:
        return jsonify({'error': 'Unauthorized'}), 401
    if not me_.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    db = current_app.config['USERS_DB']
    if not db.get_user(user_id):
        return jsonify({'error': 'ユーザーが見つかりません'}), 404
    body = await request.get_json() or {}
    kwargs = {}
    for k in ('screens', 'nodes', 'stations', 'deny_categories', 'guides'):
        if isinstance(body.get(k), list):
            kwargs[k] = [str(v) if k != 'deny_categories' else int(v) for v in body[k]]
    for k in ('can_write', 'paid'):
        if k in body:
            kwargs[k] = bool(body[k])
    return jsonify(db.update_perms(user_id, **kwargs))


@auth_bp.get('/api/admin/users')
async def admin_list_users():
    """利用者の一覧（承認待ちを含む）。管理者だけ。"""
    user = current_user()
    if not user or not user.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    return jsonify(current_app.config['USERS_DB'].list_users())


@auth_bp.delete('/api/admin/users/<int:uid>')
async def admin_delete_user(uid):
    """利用者を消す（自分自身は消せない）。管理者だけ。"""
    user = current_user()
    if not user or not user.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    if user['id'] == uid:
        return jsonify({'error': '自分自身は削除できません'}), 400
    current_app.config['USERS_DB'].delete_user(uid)
    return jsonify({'ok': True})


@auth_bp.patch('/api/admin/users/<int:uid>/prefs')
async def admin_update_user_prefs(uid):
    """利用者の視聴の制限（channel_filter・time_filter・allowed_hours）を変える。管理者だけ。"""
    user = current_user()
    if not user or not user.get('is_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    db = current_app.config['USERS_DB']
    body = await request.get_json() or {}
    kwargs = {k: v for k, v in body.items() if k in {'channel_filter', 'time_filter', 'allowed_hours'}}
    if kwargs:
        db.update_prefs(uid, **kwargs)
    return jsonify(db.get_prefs(uid))
