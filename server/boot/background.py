"""裏の仕事（ワーカー・覚えの温め・送り直し）を始める"""

import os
import threading
import time
import data_paths


import logging

# main.py と同じ名前でログに出す
logger = logging.getLogger('encode_auto')


def _start_workers(app, config):
    """一定間隔で回るワーカー（予約の同期・録画の見張り・録画の走査・エンコードの実行ほか）を起動する。"""
    rule_db      = app.config['RULE_DB']
    edcb_client  = app.config['EDCB_CLIENT']
    parser_store = app.config['PARSER_STORE']

    from workers.reserve_sync.core import ReserveSyncWorker
    reserve_sync = ReserveSyncWorker(config, rule_db, edcb_client, parser_store)
    reserve_sync.start()
    app.config['WORKERS']['reserve_sync'] = reserve_sync
    logger.info('予約の同期のワーカーを起動')

    from workers.recording_watch.core import RecordingWatchWorker
    recording_watch = RecordingWatchWorker(config, rule_db, edcb_client, parser_store)
    recording_watch.start()
    app.config['WORKERS']['recording_watch'] = recording_watch
    logger.info('録画の見張りのワーカーを起動')

    from workers.recording_scan.core import RecordingScanWorker
    recording_scan = RecordingScanWorker(config, rule_db, edcb_client, parser_store)
    recording_scan.start()
    app.config['WORKERS']['recording_scan'] = recording_scan
    logger.info('録画の走査のワーカーを起動')

    from workers.encode_runner import EncodeRunnerWorker
    encode_runner = EncodeRunnerWorker(config, rule_db)
    encode_runner.start()
    app.config['WORKERS']['encode_runner'] = encode_runner
    logger.info('エンコードの実行のワーカーを起動')

    # video自動転送ワーカー: 送信側(library_peer設定済み)のみ。encode_dir='master'の
    # videoをサーバー間で直接masterへ移動する(クライアント/ブラウザ不要)
    if ((config.get('federation') or {}).get('library_peer') or {}).get('url'):
        from workers.video_push import VideoPushWorker
        captures_dir = os.path.join(data_paths.DATA_DIR, 'captures')
        video_push = VideoPushWorker(config, app.config['VIDEO_DB'], captures_dir)
        video_push.start()
        app.config['WORKERS']['video_push'] = video_push
        logger.info('VideoPush worker started')

    # 副音声判定のバックフィルワーカー: has_secondary_audio 未判定(NULL)の動画を少しずつ埋める。
    # ffprobe が要るので一覧では測れず、カラム導入前の既存動画は再生するまで判定されないため。
    from workers.video_audio_scan import VideoAudioScanWorker
    video_audio_scan = VideoAudioScanWorker(config, app.config['VIDEO_DB'])
    video_audio_scan.start()
    app.config['WORKERS']['video_audio_scan'] = video_audio_scan

    # 実況コメントの取り直し: 録画直後の取得は過去ログが追いついておらず終わり近くが欠けるので、後から埋める
    from workers.comment_refetch import CommentRefetchWorker
    comment_refetch = CommentRefetchWorker(config, rule_db, app.config.get('VIDEO_DB'))
    comment_refetch.start()
    app.config['WORKERS']['comment_refetch'] = comment_refetch


def _start_background_threads(app, config):
    """起動直後のキャッシュの温めと、切れた録画転送・届かなかったパターンの変更の定期的な送り直し。"""
    rule_db = app.config['RULE_DB']
    edcb_client = app.config['EDCB_CLIENT']

    # 録画一覧キャッシュの起動時ウォームアップ。コールド起動直後は最初の録画一覧リクエストが
    # 重い DB 再構築(約5秒)を待たされ、ワーカー起動の CPU/IO 競合でさらに伸びる。
    # バックグラウンドで先に1回ビルドしてキャッシュを温め、最初の GUI リクエストの待ちを減らす
    # （single-flight により、温め中に来たリクエストはこのビルドを共有して待つ）。
    def _warm_caches():
        try:
            from api.routes.rec_aug import _build_rec_aug_result
            from api.routes.caches import warm_epg_albums
            # app context 外のスレッドなので db / client / logger を明示渡しする（current_app を使わない）
            _build_rec_aug_result(db=rule_db, logger=logger)
            logger.info('rec_aug cache warmed up')
            # 番組表(全TVサービス)とアルバム一覧も温める。tsid_store=app.config で get_epg と共有
            warm_epg_albums(edcb_client, app.config.get('VIDEO_DB'), logger, tsid_store=app.config,
                            dir_roots=(config.get('encode_dir_list') or []), users_db=app.config.get('USERS_DB'))
        except Exception as e:
            logger.warning('cache warm-up failed: %s', e)
    threading.Thread(target=_warm_caches, name='CacheWarmup', daemon=True).start()

    # 切れた録画転送を定期的に送り直す。起動時の1回きり(上の
    # resume_interrupted_transfers)では、相手が立ち上がりきる前に当たると
    # そこで終わってしまう。実測: こちらの再開が 17:22:18、
    # 相手のサーバーが起きたのが 17:22:25 で、7秒差の「Connection refused」のまま
    # 20GB の転送が2件放置された。finalize で失敗した phase='error' も、
    # 起動時の再開は拾わないので永久に残っていた。
    def _retry_transfers():
        from logic.encode_pipeline.runner.transfer_retry import retry_failed_transfers
        while True:
            time.sleep(300)
            try:
                n = retry_failed_transfers(rule_db, config)
                if n:
                    logger.info('切れていた転送 %d 件を送り直します', n)
            except Exception as e:
                logger.warning('転送の送り直しに失敗（続行）: %s', e)
    threading.Thread(target=_retry_transfers, name='TransferRetry', daemon=True).start()

    # パターンの変更で連携先へ届かなかった分を、つながったら順に送り直す（logic.patterns.pattern_outbox）
    def _retry_pattern_sync():
        from api.nodes.node_routes import _known_peers
        from logic.patterns import pattern_outbox
        while True:
            time.sleep(60)
            try:
                cfg = app.config['ENCODE_AUTO']   # 設定の画面で連携先を変えたら付いていく
                pattern_outbox.flush(cfg, _known_peers(cfg))
            except Exception as e:
                logger.warning('パターンの送り直しに失敗（続行）: %s', e)
    threading.Thread(target=_retry_pattern_sync, name='PatternSyncRetry', daemon=True).start()
