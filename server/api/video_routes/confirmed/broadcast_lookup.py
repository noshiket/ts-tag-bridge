"""放送（局・番組・時刻）から動画を探す"""

from quart import jsonify, current_app, request, abort
from api.routes.auth import bp
from ..library.perms import _perm_visible_videos


@bp.get('/videos/find_by_broadcast')
def find_video_by_broadcast():
    """放送の識別子(onid/tsid/sid/eid/eit_start_time)から video id を引く。

    ローカル保存キャッシュの追従に使う。relocate や master 転送で video id は変わるが、
    元になった放送は変わらないため、id で引けなくなった保存分をこれで突き合わせて
    新しい id へ張り替える。

    onid/sid/eit_start_time は必須。tsid/eid/recording_start_time/recording_end_time は
    指定されていれば絞り込みに使う。

    録画時刻(TOT)まで含めるのが要点。一挙放送を話数ごとに分割すると、同じ放送から
    作られた複数の video が全て同じ onid/tsid/sid/eid/eit_start_time を持つため
    (実データで 12634本中3462本=27%が該当。最大14本が同一)、放送だけでは別の話数を掴む。
    録画時刻は話数ごとに実測値が入るので、これを足すと重複は0本になる。

    確定値(episode_number/episode_name)は使わない。確定値編集で変わる値なので、
    まさに追従したい場面で一致しなくなる。録画時刻は実測値なので編集の影響を受けず、
    tag.json に入っているのでサーバー間で転送されても同じ値が復元される。

    見つからなければ {'id': None}。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        return jsonify({'id': None})
    q = request.args
    try:
        onid, sid = int(q['onid']), int(q['sid'])
    except (KeyError, TypeError, ValueError):
        abort(400, description='onid/sid が必要です')
    start = (q.get('eit_start_time') or '').strip()
    if not start:
        abort(400, description='eit_start_time が必要です')
    where = ['onid = ?', 'sid = ?', 'eit_start_time = ?']
    args = [onid, sid, start]
    for key in ('tsid', 'eid'):
        val = q.get(key)
        if val not in (None, ''):
            try:
                args.append(int(val))
            except (TypeError, ValueError):
                abort(400, description=f'{key} が不正です')
            where.append(f'{key} = ?')
    for key in ('recording_start_time', 'recording_end_time'):
        val = (q.get(key) or '').strip()
        if val:
            where.append(f'{key} = ?')
            args.append(val)
    row = db._get_conn().execute(
        f"SELECT id FROM videos WHERE {' AND '.join(where)} ORDER BY id LIMIT 1", args).fetchone()
    if row is None:
        return jsonify({'id': None})
    # 一覧に出ないものを識別子の総当たりで引けてしまわないよう、他と同じ可視性判定を通す
    return jsonify({'id': row['id'] if _perm_visible_videos([{'id': row['id']}]) else None})
