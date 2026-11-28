"""手動追加・掃除・アドオンの実行"""

import asyncio
import os
from quart import jsonify, current_app, request
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _delete_thumbnail_files  # noqa: F401
from api.routes.parser import _ruledb  # noqa: F401
from .deletion import _delete_frame_index, _delete_ts_files  # noqa: F401


@bp.post('/recordings/manual')
async def add_manual_recording():
    """TS ファイルを手で録画として登録する。body: {ts_path}（サーバーから見たパス）。

    フォルダを指定すると中の TS をまとめて登録する。登録済みならその行を返す。走査は後で行う（202）。
    """
    from logic.storage import path_translator as _pt
    import logging
    logger = logging.getLogger(__name__)

    body = await request.get_json(force=True) or {}
    host_ts_path = (body.get('ts_path') or '').strip()
    if not host_ts_path:
        logger.warning('manual recording rejected: ts_path is empty')
        return jsonify({'error': 'ts_path is required'}), 400

    # 1. path_translator でパス変換（host → app / amatsukaze）
    cfg = current_app.config['ENCODE_AUTO']
    my_vols = cfg.get('volumes', [])
    amz_vols = cfg.get('services', {}).get('amatsukaze', {}).get('volumes', [])
    app_ts_path        = _pt.host_to_container(host_ts_path, my_vols) if my_vols else host_ts_path
    amatsukaze_ts_path = _pt.host_to_container(host_ts_path, amz_vols)

    # 2. app_ts_path 存在確認
    if not os.path.exists(app_ts_path):
        logger.warning('manual recording rejected: TS not found: %s (app_ts_path=%s)',
                       host_ts_path, app_ts_path)
        return jsonify({'error': f'TSファイルが見つかりません: {app_ts_path}'}), 400

    db = _ruledb()
    cfg_edcb_url = ((cfg.get('edcb_servers') or [{}])[0].get('url')) or cfg.get('edcb_url', '')

    # 2.4 ディレクトリ指定: 配下の*.tsを一括登録する（登録済みhost_ts_pathはスキップ）。
    #     EIT読込等の重い処理は行わず、通常の手動登録と同様に録画の走査のpending処理に任せる
    #     (1件ずつのEITインラインスキャンは件数×最大15秒かかりリクエストが持たないため)。
    if os.path.isdir(app_ts_path):
        def _bulk_register():
            registered, skipped = 0, 0
            for root_dir, _dirs, files in os.walk(app_ts_path):
                for name in sorted(files):
                    if not name.lower().endswith('.ts'):
                        continue
                    # macOSのAppleDouble(._*)等の隠しファイルは一時ファイルなので除外
                    if name.startswith('.'):
                        continue
                    f_app = os.path.join(root_dir, name)
                    rel = os.path.relpath(f_app, app_ts_path)
                    f_host = os.path.join(host_ts_path, rel)
                    if db.get_recording_by_host_path(f_host) is not None:
                        skipped += 1
                        continue
                    db.add_recording(
                        None, None,
                        host_ts_path=f_host,
                        app_ts_path=f_app,
                        amatsukaze_ts_path=_pt.host_to_container(f_host, amz_vols),
                        server_url=cfg_edcb_url,
                    )
                    registered += 1
            return registered, skipped

        registered, skipped = await asyncio.to_thread(_bulk_register)
        logger.info('manual recording (directory): %s registered=%d skipped_existing=%d',
                    host_ts_path, registered, skipped)
        return jsonify({'directory': True, 'registered': registered,
                        'skipped_existing': skipped}), 202

    # 単一ファイル指定でも隠しファイル(._* 等の一時ファイル)は登録しない
    if os.path.basename(host_ts_path).startswith('.'):
        logger.warning('manual recording rejected: temporary/hidden file: %s', host_ts_path)
        return jsonify({'error': f'一時ファイル(先頭が.)のため登録できません: {host_ts_path}'}), 400

    # 2.5 重複防止: 同一 host_ts_path の録画が既にあれば登録せず既存を返す
    existing = db.get_recording_by_host_path(host_ts_path)
    if existing is not None:
        logger.info('manual recording skipped (duplicate host_ts_path): %s (existing id=%d, state=%s)',
                    host_ts_path, existing['id'], existing.get('state'))
        return jsonify(existing), 200

    # 3. 登録時に EIT（番組情報）を読み込んで DB に埋める。
    #    手動録画は eit_start_time が無いと録画の走査の処理順（放送開始が新しい順）で
    #    常に後回しになり、登録できたか確認できない。ここで番組情報（onid/sid/eid/title/
    #    放送時刻）を埋めておけば即座に確認でき、処理順にも正しく乗る。
    #    ドロップ/サムネ/字幕/text_parser 等の重スキャンは従来通り pending を録画の走査が
    #    拾って add_recording.process() で実行する。EIT 読込はイベントループを塞がないよう
    #    別スレッドで行い、失敗時は従来通り情報なしで登録（後で録画の走査が再スキャン）。
    from read_tsprogram import scanner as _ts
    eit: dict = {}
    try:
        scan = await asyncio.to_thread(_ts.scan_ts, app_ts_path, None, 15)
        if scan:
            eit = {
                'onid': scan.get('nid'),       'tsid': scan.get('tsid'),
                'sid':  scan.get('sid'),        'eid':  scan.get('event_id'),
                'eit_title':         scan.get('title') or None,
                'eit_description':   scan.get('description') or None,
                'eit_extended_info': scan.get('extended_info') or None,
                'eit_station_name':  scan.get('service_name') or None,
                'eit_start_time':    scan.get('start_time') or None,
                'eit_end_time':      scan.get('end_time') or None,
            }
    except Exception as e:
        logger.warning('manual recording: EIT scan failed (will rescan in 録画の走査): %s (%s)',
                       host_ts_path, e)

    # server_url は to_encode_info（エンコード先/プリセット）のデフォルト導出に使うため、
    # 通常録画と同じく先頭 EDCB サーバーの URL を入れておく。
    edcb_url = cfg_edcb_url
    row_id = db.add_recording(
        None, None,
        host_ts_path=host_ts_path,
        app_ts_path=app_ts_path,
        amatsukaze_ts_path=amatsukaze_ts_path,
        server_url=edcb_url,
        **eit,
    )
    logger.info('manual recording registered: %s (id=%d, state=pending, title=%s, sid=%s)',
                host_ts_path, row_id, eit.get('eit_title'), eit.get('sid'))

    return jsonify(db.get_recording(row_id)), 202


@bp.delete('/recordings/manual/<int:row_id>')
def delete_manual_recording(row_id):
    """手で登録した録画を消す（TS・サムネ・フレーム表も）。"""
    db = _ruledb()
    rec = db.get_recording(row_id)
    if rec:
        _delete_ts_files(rec.get('host_ts_path', ''))
        _delete_thumbnail_files(rec.get('thumbnail_path'), rec.get('thumbnail_tile_path'))
    _delete_frame_index(row_id)
    db.delete_recording(row_id)

    return jsonify({'ok': True})


