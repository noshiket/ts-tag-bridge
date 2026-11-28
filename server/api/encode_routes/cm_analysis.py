"""録画の CM 解析（結果・始める・アドオンを掛け直す）"""

import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.parser import _ruledb


@bp.get('/encode/recordings/<int:db_rec_id>/cm_analysis')
def get_recording_cm_analysis(db_rec_id):
    """録画の CM カット解析結果を返す（分割画面のシークバー用）。

    中身は logic/cmcut.analyze の戻り値。録画登録スキャンか分割画面の
    「CM解析」ボタンが入れる。未解析なら {'ready': False}。
    走らせている最中は 'job' が付く（分割画面がこれを見て進み具合を出す）。
    一覧(augmented)には載せない。数KBとはいえ全録画ぶんを毎回運ぶ必要はない。
    """
    import json as _j
    from logic import add_recording as _addrec
    rec = _ruledb().get_recording(db_rec_id)
    if rec is None:
        abort(404)
    job = _addrec.cm_job(db_rec_id)
    raw = rec.get('cm_analysis')
    if not raw:
        # 失敗して残っていない場合は理由も返す（分割画面が出す）
        return jsonify({'ready': False, 'job': job, 'error': rec.get('cm_error')})
    try:
        result = _j.loads(raw)
    except (ValueError, TypeError):
        return jsonify({'ready': False, 'job': job, 'error': 'cm_analysis が壊れています'})
    # 古い解析結果はフレーム表の先頭が原点で、プレイヤーの再生時刻と一定量ずれる
    from logic import cmcut as _cmcut
    ts_path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
    return jsonify({'ready': True, 'job': job,
                    'result': _cmcut.align_to_first_pts(result, db_rec_id, ts_path)})


@bp.post('/encode/recordings/<int:db_rec_id>/cm_analysis')
def start_recording_cm_analysis(db_rec_id):
    """CM解析を後付けで走らせる（分割画面の「CM解析」ボタン）。

    登録スキャン時の解析は1回きりで、局の設定やロゴが無い・フレーム表が作れない等で
    落ちた録画はそのまま未解析で残る。やり直す口はここだけなので消さないこと。
    解析は数分かかるので投げっぱなしにし、進み具合は GET 側の 'job' で見る。
    """
    from logic import add_recording as _addrec
    db = _ruledb()
    rec = db.get_recording(db_rec_id)
    if rec is None:
        abort(404)
    ts_path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
    if not ts_path or not os.path.isfile(ts_path):
        abort(404, description='TSファイルが見つかりません')
    r = _addrec.start_cm_analysis(db, db_rec_id, ts_path,
                                  current_app.config['ENCODE_AUTO'], current_app.logger)
    if r == 'busy':
        return jsonify({'started': False, 'reason': 'busy',
                        'job': _addrec.cm_job(db_rec_id)}), 409
    return jsonify({'started': True, 'job': _addrec.cm_job(db_rec_id)})


@bp.post('/encode/recordings/<int:db_rec_id>/cm_analysis/addons')
def rerun_recording_cm_addons(db_rec_id):
    """CM解析の**アドオンだけ**を保存済みの結果へ掛け直す。

    解析そのもの（chapterexe と join_logo_scp）は数分〜十数分かかるので、
    アドオン側の直しを試すたびに全部やり直すのは高い。target='cm_analysis' の
    アドオンは結果(dict)を受け取って直すだけなので、保存済みの結果へ掛け直せる。

    自分で TS を読み直すアドオンもあるため、掛け直しは数十秒〜数分
    かかる（実測: 30分の録画で 75秒）。投げっぱなしにはせず待たせるが、
    アドオンが増えたら job 方式へ寄せること。
    """
    import json as _j
    from logic.addons import addon_runner
    db = _ruledb()
    rec = db.get_recording(db_rec_id)
    if rec is None:
        abort(404)
    raw = rec.get('cm_analysis')
    if not raw:
        return jsonify({'error': 'まだ CM解析がありません'}), 400
    try:
        result = _j.loads(raw)
    except (ValueError, TypeError):
        return jsonify({'error': 'cm_analysis が壊れています'}), 400
    ts_path = rec.get('app_ts_path') or rec.get('host_ts_path') or ''
    before = {k: len(v) for k, v in result.items() if isinstance(v, list)}
    out = addon_runner.run_cm_analysis(result, rec, ts_path,
                                       log=lambda m: current_app.logger.info(
                                           'cm_addons rec=%d %s', db_rec_id, m))
    db.update_recording(db_rec_id, cm_analysis=_j.dumps(out, ensure_ascii=False))
    after = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    current_app.logger.info('cm_addons: rec=%d %s → %s', db_rec_id, before, after)
    return jsonify({'ok': True, 'before': before, 'after': after})
