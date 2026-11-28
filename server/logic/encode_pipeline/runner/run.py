"""1件を最後まで進める（run_one_encoding / add_encode_queue）"""

import json
from ..common import (  # noqa: F401
    logger,
)
from ..base.states import STATE_NUM, _finalize_if_error
from ..base.context import (  # noqa: F401
    _addon_encoder_name,
    _resolve_encode_context,
    _to_container_paths,
    _update_recording_rollup,
)
from ..base.amz_logs import drop_amz_log
from ..base.disk import cleanup_orphan_tmp, set_thread_io_idle
from ..base.tmp_dir import tmp_dir_for_enc  # noqa: F401
from ..step_split_ts import (  # noqa: F401
    run_split_ts,
)
from ..step_encoding import (  # noqa: F401
    run_encoding,
    run_encoding_addon,
)
from ..step_analyze import (  # noqa: F401
    run_encoded_analyze,
)
from ..step_file_copy import (  # noqa: F401
    run_file_copy,
)
from ..step_delete import (  # noqa: F401
    run_delete,
)
from ..checks import (  # noqa: F401
    _verify_and_route,
)
from .video_addon_job import _run_video_addon_job  # noqa: F401
from .create import create_encodings  # noqa: F401
from .run_errors import _on_step_exception, _work_space_shortage


def run_one_encoding(db, enc_id: int, config: dict, stop_event=None) -> None:
    """単一 encoding を split_ts → encoding → encoded_analyze → file_copy → delete と
    進めて encode_end にする。途中失敗時は encode_error にする。

    make_DB は行わない（行は create_encodings で作成済み前提）。最後に
    recordings.state を rollup する。エンコードの実行が pending encoding を 1 件ずつ
    同期実行する想定。
    """
    from clients.amatsukaze_api.core import AmatsukazeClient

    # このスレッドは分割で数GBを読み書きする。録画と同じディスクなので、
    # I/O 優先度を下げておかないと書き込みと競合してドロップを起こす。
    if set_thread_io_idle():
        logger.debug('run_one_encoding: enc_id=%d I/O優先度を idle にしました', enc_id)

    # 取りかかる時点で前回の失敗ログは用済みにする。残しておくと、
    # いつの失敗のものか分からなくなる
    drop_amz_log(enc_id)

    enc = db.get_encoding(enc_id)
    if not enc:
        logger.warning('run_one_encoding: enc_id=%d not found', enc_id)
        return

    # 録画のエンコードではない仕事（video.db の動画にアドオンを掛ける等）は
    # ここで分ける。encode_type とは別の軸にしてあるのは、あれが「録画を
    # どのエンコーダーで処理するか」の指定で、MP4→MP4 の変換は属さないため。
    if (enc.get('job_kind') or '') == 'video_addon':
        _run_video_addon_job(db, enc, config)
        return

    recording_id = enc['recording_id']
    recording = db.get_recording(recording_id)
    if not recording:
        db.update_encoding(enc_id, state='encode_error', error_message='recording not found')
        return

    logger.info('run_one_encoding: enc_id=%d 開始 (rec=%d ep=%s/%s state=%s) %s',
                enc_id, recording_id, enc.get('episode_idx'), enc.get('episode_count'),
                enc.get('state'), recording.get('title'))

    ctx = _resolve_encode_context(recording, config)
    addon_name = _addon_encoder_name(ctx['encode_type']) if ctx else None
    if ctx is None or (ctx['encode_type'] != 'amatsukaze_servers' and not addon_name):
        db.update_encoding(enc_id, state='encode_error',
                           error_message='to_encode_info 未設定 / 非対応 encode_type')
        _update_recording_rollup(db, recording_id)
        return

    amz_vols = ctx['amz_vols']
    source_ts_app = ctx['source_ts_app']
    # アドオンエンコーダーはAmatsukazeを使わない(client=Noneで各ステップがキュー操作を飛ばす)
    client = None if addon_name else AmatsukazeClient(ctx['amz_url'])

    encode_info = json.loads(enc.get('encode_info') or '{}')
    if _to_container_paths(encode_info, amz_vols):
        # 作り済みのエンコード（直す前に録画詳細で作られた分）もここで直す
        logger.info('run_one_encoding: enc_id=%d input_ts/dstPath をコンテナ内パスに直しました: %s',
                    enc_id, encode_info.get('input_ts'))
        db.update_encoding(enc_id, encode_info=json.dumps(encode_info, ensure_ascii=False))
    target_state = _verify_and_route(db, enc, encode_info, amz_vols)

    if target_state >= STATE_NUM['encode_end']:
        db.update_encoding(enc_id, state='encode_end', error_message=None, progress=1.0)
        _update_recording_rollup(db, recording_id)
        logger.info('run_one_encoding: enc_id=%d already complete', enc_id)
        return

    # enc を最新に再取得（_verify_and_route が state を変更している場合がある）
    enc = db.get_encoding(enc_id)

    try:
        if target_state <= STATE_NUM['split_ts']:
            run_split_ts(db, enc, source_ts_app, amz_vols, config)
            if _finalize_if_error(db, enc_id, 'split_ts', recording_id, config):
                return
            db.update_encoding(enc_id, state='encoding')
            enc = db.get_encoding(enc_id)
            target_state = STATE_NUM['encoding']

        if target_state <= STATE_NUM['encoding']:
            # 何時間も走るので、取りかかる直前に置き去りを片付けて空きを確かめる。
            # 分割時にも見ているが、その後に他の処理が食い潰して最後の多重化で
            # 溢れることがある（実測: 2時間24分かけた末に
            # "No space left on device" で失敗）。
            cleanup_orphan_tmp()
            err = _work_space_shortage(source_ts_app, config, tmp_dir_for_enc(db, enc, config))
            if err:
                db.update_encoding(enc_id, error_message=err)
                logger.warning('run_one_encoding: enc_id=%d %s', enc_id, err)
                _finalize_if_error(db, enc_id, 'encoding', recording_id, config)
                return
            if addon_name:
                run_encoding_addon(db, enc, addon_name, ctx, recording, config, stop_event)
            else:
                run_encoding(db, enc, client, amz_vols, stop_event)
            if _finalize_if_error(db, enc_id, 'encoding', recording_id, config):
                return
            db.update_encoding(enc_id, state='encoded_analyze')
            enc = db.get_encoding(enc_id)
            target_state = STATE_NUM['encoded_analyze']

        if target_state <= STATE_NUM['encoded_analyze']:
            run_encoded_analyze(db, enc, source_ts_app, amz_vols, config)
            if _finalize_if_error(db, enc_id, 'encoded_analyze', recording_id, config):
                return
            db.update_encoding(enc_id, state='file_copy')
            enc = db.get_encoding(enc_id)
            target_state = STATE_NUM['file_copy']

        if target_state <= STATE_NUM['file_copy']:
            copy_ok = run_file_copy(db, enc, amz_vols, client, config)
            if _finalize_if_error(db, enc_id, 'file_copy', recording_id, config):
                return
            if copy_ok:
                db.update_encoding(enc_id, state='delete')
                target_state = STATE_NUM['delete']
    except Exception as e:
        _on_step_exception(db, enc_id, recording_id, config, e)
        return

    if target_state <= STATE_NUM['delete']:
        run_delete(db, enc, client, amz_vols)
        db.update_encoding(enc_id, state='encode_end', error_message=None, progress=1.0)

    _update_recording_rollup(db, recording_id)
    logger.info('run_one_encoding: enc_id=%d complete', enc_id)


def add_encode_queue(db, recording_id: int, config: dict, stop_event=None,
                     stop_after=None, only_enc_id: int = None) -> None:
    """[互換用] recording 単位フルラン。

    エンコードの実行は run_one_encoding を使うため通常は使われない。デバッグスクリプトや
    retry の stop_after='make_DB'（DB 作成のみ）経路のために残す。
      - create_encodings で encodings を作成（make_DB）
      - stop_after=='make_DB' ならここで終了
      - 残りの encodings を run_one_encoding で順に実行（only_enc_id 指定時はそれだけ）
    """
    create_encodings(db, recording_id, config)
    if stop_after == 'make_DB':
        logger.info('add_encode_queue: recording_id=%d stop_after=make_DB, done', recording_id)
        return
    for enc in db.get_encodings(recording_id):
        if only_enc_id is not None and enc['id'] != only_enc_id:
            continue
        run_one_encoding(db, enc['id'], config, stop_event)
