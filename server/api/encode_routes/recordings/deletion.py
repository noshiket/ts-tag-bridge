"""録画を消す（TS・フレーム表も）"""

import data_paths
from quart import jsonify, request
from api.routes.auth import bp
from api.routes.edcb_call import _client
from api.routes.caches import _delete_thumbnail_files
from api.routes.parser import _ruledb


def _delete_ts_files(host_ts_path: str):
    """TS ファイルと関連ファイル (.program.txt, .err, .log, .parts/) を削除する。"""
    import os
    import shutil
    if not host_ts_path:
        return
    # .log は配信を取り込むアドオンが残す記録
    for p in [host_ts_path, host_ts_path + '.program.txt', host_ts_path + '.err',
              host_ts_path + '.log', host_ts_path + '.record.json']:
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass
    # 途切れて録り直した時の元の断片。<TS>.parts/ にまとめてある
    try:
        shutil.rmtree(host_ts_path + '.parts', ignore_errors=True)
    except Exception:
        pass


def _delete_frame_index(rec_row_id):
    """フレーム表キャッシュ(server/data/frame_index/<rec_row_id>.fidx.gz)を削除する。"""
    if rec_row_id is None:
        return
    from media.frame_index.cache import delete_frame_table
    data_dir = data_paths.DATA_DIR
    delete_frame_table(rec_row_id, data_dir)


@bp.delete('/recordings/<int:rec_id>')
def delete_recording(rec_id):
    """録画を消す（TS・サムネ・フレーム表も）。EDCB の録画情報も消す（?skip_edcb=true で残す）。

    EDCB 由来でない録画（アドオンが録った物）は recordings.id で指定する。
    """
    db = _ruledb()
    db_rec = db.get_recording_by_rec_id(rec_id)
    skip_edcb = request.args.get('skip_edcb', '').lower() == 'true'

    # 録画結果の一覧には id の体系が2つ混ざる。EDCB 由来の行は EDCB の rec_id、
    # アドオンが録った行（配信の取り込みなど）は EDCB に存在しないので
    # recordings.id が出ている。rec_id で引けなければ recordings.id で引き直す。
    # 取り違えないよう、rec_id を持たない行(=EDCB 由来でない)に限る。
    # これが無いとアドオンの録画が消せず、しかも EDCB へ無関係な rec_id で
    # del_rec_info を投げてしまう
    not_edcb = False
    if db_rec is None:
        cand = db.get_recording(rec_id)
        if cand is not None and cand.get('rec_id') is None:
            db_rec = cand
            not_edcb = True

    if db_rec:
        _delete_ts_files(db_rec.get('host_ts_path', ''))
        _delete_thumbnail_files(db_rec.get('thumbnail_path'), db_rec.get('thumbnail_tile_path'))
        _delete_frame_index(db_rec.get('id'))

    if not_edcb:
        # EDCB に無い録画。del_rec_info は投げないし、ignore_rec_id にも入れない
        # （ここで渡ってくるのは recordings.id で、EDCB の rec_id とは別の体系。
        #   無視リストへ入れると同じ番号の EDCB 録画を巻き添えにする）
        pass
    elif skip_edcb:
        db.ignore_rec_id(rec_id)
    else:
        try:
            _client().del_rec_info(rec_id)
            db.unignore_rec_id(rec_id)
        except Exception as e:
            # EDCB が踏めなくても DB(recording+program)/TS 削除は続行する。
            # EDCB 側に録画情報が残るため、ignore_rec_id で B-0 による再登録を防ぐ。
            import logging
            logging.getLogger(__name__).warning(
                'delete_recording: EDCB del_rec_info(%s) failed, continue DB delete: %s', rec_id, e)
            db.ignore_rec_id(rec_id)

    if db_rec:
        db.delete_recording(db_rec['id'])

    return jsonify({'ok': True})
