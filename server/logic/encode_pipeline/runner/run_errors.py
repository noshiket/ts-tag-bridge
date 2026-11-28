"""エンコードの工程の失敗の扱い（作業場所の不足・例外）"""

import os
from ..common import logger
from ..base.states import _label_error, _save_failed_state
from ..base.amz_logs import _purge_tmp_on_error
from ..base.context import _update_recording_rollup
from ..base.disk import ensure_free_space


def _work_space_shortage(source_ts_app, config, work_dir=None):
    """エンコードの作業領域の空きが足りなければ、その理由。足りれば None。

    何時間も走るので、取りかかる直前に空きを確かめる。中間ファイル・出力・多重化の
    一時コピーで、元TSと同程度は要る。確認先は**作業領域**。元TSは別ドライブ(22TB)に
    あるので、そちらを見ても意味がない
    """
    if not (source_ts_app and os.path.exists(source_ts_app)):
        return None
    need = os.path.getsize(source_ts_app)
    err = None
    # 作業ディレクトリは、このエンコードが実際に使っている所（TS 分割の時に空きのある候補へ
    # 移していることがある）。分からなければ tmp_base
    work_base = os.path.dirname(work_dir.rstrip('/')) if work_dir else (config.get('tmp_base') or '/tmp')
    for where, label in ((work_base, '作業ディレクトリ'),
                         ('/tmp', '多重化の一時領域')):
        if os.path.isdir(where):
            err = ensure_free_space(where, need, label)
            if err:
                break
    return err


def _on_step_exception(db, enc_id, recording_id, config, e):
    """段の途中で例外が出た時の後始末（失敗の記録・作業フォルダの掃除・録画の状態の更新）。"""
    # 行が消えていれば、再登録(requeue)や削除でこちらを止めた側の意図。
    # 失敗として記録・通知すると「エンコード失敗」の誤報になる
    # （実際 requeue のたびに古い方の中断が失敗として飛んでいた）。
    cur = db.get_encoding(enc_id)
    if cur is None:
        logger.info('run_one_encoding: enc_id=%d 中断（行が削除された）: %s', enc_id, e)
        _purge_tmp_on_error(db, enc_id, config)
        _update_recording_rollup(db, recording_id)
        return
    # 例外発生時、encoding 行の state は失敗したサブステップ名を保持している
    # （各 run_* が冒頭で state をセットするため）。それをラベルに使う。
    failed_state = cur.get('state', '?')
    logger.error('run_one_encoding: enc_id=%d step failed at state=%s: %s',
                 enc_id, failed_state, e)
    db.update_encoding(enc_id, state='encode_error',
                       error_message=_label_error(failed_state, e))
    _save_failed_state(db, enc_id, failed_state)
    _purge_tmp_on_error(db, enc_id, config)
    _update_recording_rollup(db, recording_id)
