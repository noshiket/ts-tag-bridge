"""エンコード履歴のプルーニング — config.yml の encode_history_limit を超えた
encode_end の encodings を古い順に削除する。

各削除 encoding について:
  1. その tmp_dir（recordings.tmp_dirs[episode_idx]）を削除
  2. encodings 行を削除
  3. 同じ recording_id の encoding が他に残らなければ、参照元の recording も削除する
     （recordings 行 + 参照元TS + .program.txt + .err + サムネ。EDCB は残し、
      ignore_rec_id で録画の見張り（手順0） の再登録を防ぐ）。複数話は他の encoding が TS を
      参照するため、最後の1本が消えるまで TS は残る。
"""

import data_paths  # server/ と server/data の場所
from logic.storage import work_bases
import json
import logging
import os
import shutil

logger = logging.getLogger(__name__)


def _delete_recording_files(rec: dict):
    """録画の参照元TS(+.program.txt/.err) とサムネ・フレーム表キャッシュを削除する
    （EDCB は残す）。エンコード履歴prune / db_cleanup / fed重複削除が共用する。"""
    host_ts = rec.get('host_ts_path') or ''
    paths = []
    if host_ts:
        paths += [host_ts, host_ts + '.program.txt', host_ts + '.err']
    paths += [rec.get('thumbnail_path'), rec.get('thumbnail_tile_path')]
    for p in paths:
        if not p:
            continue
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception as e:
            logger.warning('prune: file remove failed: %s: %s', p, e)
    # フレーム表キャッシュ(server/data/frame_index/<id>.fidx.gz)も削除(孤児化防止)
    try:
        from media.frame_index.cache import delete_frame_table
        delete_frame_table(rec.get('id'), data_paths.DATA_DIR)
    except Exception as e:
        logger.warning('prune: frame_index remove failed rec=%s: %s', rec.get('id'), e)


def delete_recording_tmp_dirs(rec: dict, tmp_base: str, extra_bases=()) -> int:
    """録画に紐づく tmp_dir を全て削除する。戻り値は削除したディレクトリ数。

    _prune_one は encoding 単位で tmp_dirs[episode_idx] しか消さないため、encoding が
    作られなかった話（分割の SKIP 分など）の tmp_dir が残ったまま recordings 行が消え、
    参照を失った孤児ディレクトリになっていた（実測 14 本 81GB が滞留）。
    録画行を消す直前にこれを呼び、残り全部をまとめて消す。
    """
    if not rec:
        return 0
    bases = work_bases.search_bases(tmp_base, extra_bases)
    if not bases:
        return 0
    tmp_dirs = rec.get('tmp_dirs')
    try:
        tmp_dirs = json.loads(tmp_dirs) if isinstance(tmp_dirs, str) else (tmp_dirs or [])
    except (json.JSONDecodeError, TypeError):
        return 0
    removed = 0
    for token in (tmp_dirs or []):
        if not token:
            continue
        for base in bases:
            d = os.path.join(base, str(token))
            if not os.path.isdir(d):
                continue
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
            logger.debug('prune: recording_id=%s tmp_dir removed: %s', rec.get('id'), d)
    return removed


def _prune_one(db, enc: dict, tmp_base: str, config: dict = None):
    enc_id = enc['id']
    recording_id = enc.get('recording_id')
    rec = db.get_recording(recording_id) if recording_id else None

    # このエンコードの作業フォルダの置き場。録画詳細で tmp_base 以外を直接指定していると
    # そちらにある（tmp_base だけ見ていたので消えずに残っていた）
    extra = []
    if config is not None:
        try:
            from logic.encode_pipeline.base.tmp_dir import tmp_dir_for_enc
            wd = tmp_dir_for_enc(db, enc, config)
            if wd:
                extra.append(os.path.dirname(wd))
                work_bases.remember(os.path.dirname(wd), tmp_base)
        except Exception as e:
            logger.warning('prune: enc_id=%d 作業フォルダの場所を割り出せません: %s', enc_id, e)
    bases = work_bases.search_bases(tmp_base, extra)

    # 1. tmp_dir 削除（recordings.tmp_dirs[episode_idx]）
    if rec and bases:
        idx = enc.get('episode_idx')
        if idx is None:
            idx = enc.get('order_index', 0) or 0
        tmp_dirs = rec.get('tmp_dirs')
        try:
            tmp_dirs = json.loads(tmp_dirs) if isinstance(tmp_dirs, str) else (tmp_dirs or [])
        except Exception:
            tmp_dirs = []
        if isinstance(idx, int) and 0 <= idx < len(tmp_dirs) and tmp_dirs[idx]:
            for base in bases:
                d = os.path.join(base, tmp_dirs[idx])
                if os.path.isdir(d):
                    shutil.rmtree(d, ignore_errors=True)
                    logger.debug('prune: enc_id=%d tmp_dir removed: %s', enc_id, d)

    # 2. encodings 行削除（失敗したまま等で Amatsukaze に項目が残っていれば、番号が分かるうちに消す）
    if config is not None and enc.get('state') != 'encode_end':
        try:
            from logic.encode_pipeline.discard import discard_encoding
            discard_encoding(db, enc_id, config, delete_row=False, who='prune')
        except Exception as e:
            logger.warning('prune: enc_id=%d 片付けに失敗: %s', enc_id, e)
    db.delete_encoding(enc_id)

    # 3. 同じ recording_id の encoding が残っていなければ recording も削除（EDCB は残す）
    if recording_id and not db.get_encodings(recording_id):
        if rec:
            # 録画行を消すと tmp_dirs の参照が失われるので、残っている tmp_dir を先に全部消す
            # （SKIP 等で encoding が作られなかった話の分がここまで残っている）
            delete_recording_tmp_dirs(db.get_recording(recording_id) or rec, tmp_base, extra)
            _delete_recording_files(rec)
            rid = rec.get('rec_id')
            if rid is not None:
                db.ignore_rec_id(rid)  # B-0 による再登録を防ぐ
            db.delete_recording(recording_id)
            logger.debug('prune: recording_id=%d removed (no remaining encodings, EDCB kept)', recording_id)


def prune_encode_history(db, config: dict):
    """encode_end の encodings が encode_history_limit を超えていれば完了が古い順に削除する。"""
    limit = config.get('encode_history_limit')
    if not isinstance(limit, int) or limit <= 0:
        return  # 未設定/無効なら何もしない
    done = db.list_encodings('encode_end')
    # 完了時刻（updated_at = encode_end 到達時刻）の新しい順に並べ替える。
    # id 順だと再実行・滞留などで「完了した順」とずれ、新しく完了したものが先に消える不具合になるため。
    done.sort(key=lambda e: (e.get('updated_at') or e.get('created_at') or ''), reverse=True)
    if len(done) <= limit:
        return
    tmp_base = config.get('tmp_base', '') or ''
    to_delete = done[limit:]  # 上限を超えた = 完了が古い側
    logger.info('prune: encode_end=%d > limit=%d → delete %d oldest-completed', len(done), limit, len(to_delete))
    for enc in to_delete:
        try:
            _prune_one(db, enc, tmp_base, config)
        except Exception as e:
            logger.error('prune: enc_id=%s failed: %s', enc.get('id'), e)
