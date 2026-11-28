"""起動時に DB を開く・片付け・ライブの用意"""

import os
import data_paths


import logging

# main.py と同じ名前でログに出す
logger = logging.getLogger('encode_auto')


def _open_databases(app, config):
    """users.db・rules.db・video.db を開いて移行し、それらを使う部品（text_parser・ディスク登録・
    ffprobe・アドオンの通知）を準備する。"""
    # UsersDB（認証・ユーザー設定・視聴履歴）
    users_db_path = os.path.join(data_paths.DATA_DIR, 'users.db')
    os.makedirs(os.path.dirname(users_db_path), exist_ok=True)
    from db.user_db.core import UsersDB
    users_db = UsersDB(users_db_path)
    users_db.init_db()
    app.config['USERS_DB'] = users_db
    logger.info('UsersDB: %s', users_db_path)

    # ProgramDB
    rule_db_path = os.path.join(data_paths.DATA_DIR, 'rules.db')
    os.makedirs(os.path.dirname(rule_db_path), exist_ok=True)
    from db.rule_db.core import ProgramDB
    rule_db = ProgramDB(rule_db_path)
    rule_db.init_db()
    app.config['RULE_DB'] = rule_db
    logger.info('ProgramDB: %s', rule_db_path)

    # text_parser にアドオンの解析アクションと sid → 放送局名の表を渡す
    from logic.patterns import parser_setup
    parser_setup.setup(rule_db_path)

    # encode_dir_list の外部ディスクを登録（取り外し検知用マーカーを用意）
    try:
        from logic.storage.disk_guard import register_encode_dirs
        register_encode_dirs(rule_db, config)
    except Exception as e:
        logger.warning('encode_dir ディスク登録に失敗: %s', e)

    # ffprobe の既定パス（VideoDB など ffprobe_path を引数で受け取れない呼び出し元が使う）
    from media.probe import ffprobe as _ffprobe
    _ffprobe.configure(config.get('ffprobe'))

    # VideoDB（エンコード完了後の動画管理）
    video_db_path = os.path.join(data_paths.DATA_DIR, 'video.db')
    from db.video_db.core import VideoDB
    video_db = VideoDB(video_db_path)
    video_db.init_db()
    app.config['VIDEO_DB'] = video_db
    logger.info('VideoDB: %s', video_db_path)

    # アドオンのフェーズ通知(target='event')。init 前の emit は無視されるため、
    # DB を揃えたこの時点で有効化する。
    from logic.addons import addon_events
    addon_events.init(config, rule_db=app.config.get('RULE_DB'), video_db=video_db)


def _startup_housekeeping(app, config):
    """起動時の後片付け（中断した転送の送り直し・参照の無い作業フォルダの掃除・録画フォルダの容量の確認）。"""
    from logic.addons import addon_events
    # 再起動で中断したノードへの録画転送を送り直す。転送はデーモンスレッドなので
    # プロセスと一緒に死ぬが、transfer_state は 'sending' のまま残り、誰も再開しない
    # ので録画は waiting のまま永久に何も起きない（実測: 19GB中1.5GBで停止）。
    try:
        from logic.encode_pipeline.runner.transfer_retry import resume_interrupted_transfers
        n = resume_interrupted_transfers(app.config['RULE_DB'], config)
        if n:
            logger.info('起動時: 中断していた転送 %d 件を送り直します', n)
    except Exception as e:
        logger.warning('起動時の転送再開に失敗（続行）: %s', e)

    # 参照の無い tmp 作業ディレクトリを起動時に掃除する。エンコード履歴が上限で
    # 消えたあとも作業ディレクトリだけが残り、元TSと同じくらいの大きさのまま
    # 居座ってディスクを埋める（実測: 5時間ものの1本ぶんで 44GB）。
    try:
        from logic.cleanup.tmp_dir_cleanup import _purge_orphan_tmp_dirs
        n = _purge_orphan_tmp_dirs(app.config['RULE_DB'], config.get('tmp_base'))
        if n:
            logger.info('起動時の掃除: 参照の無い作業ディレクトリを %d 個削除しました', n)
    except Exception as e:
        logger.warning('起動時の作業ディレクトリ掃除に失敗（続行）: %s', e)

    # 起動時に EDCB の録画フォルダ容量を前回と突き合わせる。
    # Docker の EDCB でマウントが失敗すると、パスは在るのに実体が別ディスクになり、
    # そのまま録画するとマウントされていない場所へ書いてしまう。容量が変わっていれば
    # それに気づける（EDCB が書き込み先を決めるのも起動時なので、ここで1回見れば足りる）。
    try:
        from logic.storage import storage_watch
        changes = storage_watch.check(app.config['EDCB_CLIENT'],
                                      data_paths.DATA_DIR)
        if changes:
            for c in changes:
                logger.warning('storage: %s', storage_watch.describe(c))
            addon_events.emit('storage.changed', {
                'changes': changes,
                'lines': [storage_watch.describe(c) for c in changes],
            })
    except Exception as e:
        logger.warning('storage_watch: 容量の確認に失敗(無視): %s', e)


def _setup_live_stream(app, config):
    """ライブストリーミング（EDCB の TCP 出力）を準備する。設定が無ければ何もしない。"""
    streaming_config = config.get('streaming', {})
    if streaming_config:
        edcb_server_name = streaming_config.get('edcb_server', '')
        tcp_url = ''
        for srv in (config.get('edcb_servers') or []):
            if srv.get('name') == edcb_server_name:
                tcp_url = srv.get('tcp_url', '')
                break
        if tcp_url:
            try:
                edcb_client_for_streaming = app.config['EDCB_CLIENT']
                from media.tsukujima.live_stream import LiveStream
                from media.tsukujima.quality import override_library_paths
                override_library_paths(config)
                # 起動時に EDCB が不通でも、service_fetcher を渡しておけば
                # チャンネル一覧アクセス時に自動で再構築される (self-healing)
                try:
                    services = edcb_client_for_streaming.enum_service()
                except Exception as e:
                    logger.warning('LiveStream: 起動時の enum_service 失敗 (後で自動再取得): %s', e)
                    services = []
                LiveStream.configure(tcp_url, services, streaming_config,
                                     service_fetcher=edcb_client_for_streaming.enum_service)
                logger.info('LiveStream configured: tcp_url=%s', tcp_url)
            except Exception as e:
                logger.warning('LiveStream initialization failed: %s', e)
        else:
            logger.info('LiveStream not configured: no tcp_url found for edcb_server=%s', edcb_server_name)
