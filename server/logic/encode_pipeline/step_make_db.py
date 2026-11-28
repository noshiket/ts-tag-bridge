"""Step 1: make_DB"""

import copy
import json
import os
from typing import Optional
from logic.storage.path_translator import container_to_host, host_to_container
from .output_check import output_missing_reason
from .common import (  # noqa: F401
    logger,
)
from .base.context import _to_container_paths  # noqa: F401
from .trim.avs import _parse_trim_mode_segments  # noqa: F401
from .placeholders import (  # noqa: F401
    _fix_folder_segment,
    _list_val,
    _substitute_placeholders,
)


# ===========================================================================
# Step 1: run_make_db
# ===========================================================================

def run_make_db(db, recording_id: int, recording: dict, tmp_dirs: list,
                encode_preset_tpl: dict, amz_vols: list,
                encode_dir: Optional[str] = None, tmp_base: str = '', config: dict = None) -> None:
    """
    encodings レコードを作成する（既存があれば削除して再作成）。
    state = wait_encode で INSERT。

    注: 出力ディレクトリ作成・初期 tag.json 書き出しはここでは行わず、
    各エンコードの初回処理（run_split_ts の冒頭）で実施する。
    """
    # TS ファイル存在チェック
    app_ts_path = recording.get('app_ts_path', '')
    if not app_ts_path or not os.path.exists(app_ts_path):
        err = f'録画ファイルが見つかりません: {app_ts_path}'
        db.update_recording(recording_id, state='error', error_message=err)
        logger.warning('run_make_db: recording_id=%d %s', recording_id, err)
        raise FileNotFoundError(err)

    # 出力先の無い話はエンコードしても最後のコピーで必ず失敗する（エンコードが無駄になる）ので、
    # キューに積む前に止める。今ある行・Amatsukaze の項目には触らない
    err = output_missing_reason(recording)
    if err:
        db.update_recording(recording_id, state='error', error_message=err)
        logger.warning('run_make_db: recording_id=%d %s', recording_id, err)
        raise ValueError(err)

    existing = db.get_encodings(recording_id)
    if existing:
        # 行だけ消すと、Amatsukaze のキューに前の項目が失敗のまま残り続ける（番号は行にしか無い）
        if config is not None:
            from .discard import discard_encoding
            for ex in existing:
                discard_encoding(db, ex['id'], config, delete_row=False, who='run_make_db')
        for ex in existing:
            db.update_encoding(ex['id'], state='make_DB')
        db.delete_encodings(recording_id)

    n = len(tmp_dirs)
    # encode_preset の {$tmp_base} 用。preset は Amatsukaze(コンテナ)が読むので
    # コンテナ側のパスへ直しておく（例 /home/x/tmp → /host-rootfs/home/x/tmp）
    tmp_base_amz = host_to_container(tmp_base, amz_vols) if tmp_base else ''

    # segments を JSON パースしてから _write_tag_json に渡す
    rec_for_tag = dict(recording)
    segs_raw = rec_for_tag.get('segments')
    if isinstance(segs_raw, str):
        try:
            rec_for_tag['segments'] = json.loads(segs_raw)
        except Exception:
            pass

    for i, tmp_dir in enumerate(tmp_dirs):
        encode_info = _substitute_placeholders(
            copy.deepcopy(encode_preset_tpl), recording, i, tmp_dir,
            tmp_base_amz, tmp_base
        )
        _to_container_paths(encode_info, amz_vols)

        # segments 無し（単話）の入力準備方針を make_DB で決める（tag.json の stem を
        # 確定させるため split 前に決定する）:
        #   ・ソースTSと tmp が別ドライブ → input_ts は preset の cut.ts のまま。split_ts で
        #     ソースTSを cut.ts へコピーし、エンコード時の録画ディスク読み込みを tmp へ隔離する。
        #   ・同一ドライブ → コピーは隔離効果がなく無駄（同一ディスク競合も生む）なので、
        #     input_ts をソースTS直接参照にする（コピーしない）。
        segs_all = rec_for_tag.get('segments')
        episode_segs = segs_all[i] if isinstance(segs_all, list) and i < len(segs_all) else None
        # 'full'マーカー(単話・全体)は時間区間ではないため、segments無しと同じ扱い(分割しない)
        is_full_seg = isinstance(episode_segs, str) and episode_segs.split(',')[0] == 'full'
        # trim指定あり(trimモード)は input_ts=tmp/cut.ts(リンク)を維持する必要が
        # あるため、ソースTS直接参照の最適化は適用しない（run_split_ts のtrim分岐が前提）
        has_trim = isinstance(episode_segs, str) and _parse_trim_mode_segments(episode_segs) is not None
        if (not episode_segs or is_full_seg) and not has_trim:
            source_ts_app = recording.get('app_ts_path', '')
            tmp_dir_app = container_to_host(os.path.dirname(encode_info.get('input_ts', '')), amz_vols)
            # st_dev 比較のためだけにリーフ tmp_dir を作るのは避ける（tmp_dir の実作成は
            # run_split_ts の初回処理に一本化する）。既存の最寄り祖先で同一ドライブ判定する。
            probe = tmp_dir_app
            while probe and not os.path.exists(probe):
                probe = os.path.dirname(probe)
            try:
                same_drive = os.stat(source_ts_app).st_dev == os.stat(probe).st_dev
            except OSError:
                same_drive = False
            if same_drive:
                encode_info['input_ts'] = host_to_container(source_ts_app, amz_vols)

        # 一次ファイル tag.json パスの算出のみ行う。
        # 出力ディレクトリ作成・初期 tag.json 書き出しは run_split_ts の冒頭
        # （各エンコードの初回処理）へ移設した。
        outputs = encode_info.get('outputs', [])
        if isinstance(outputs, dict):
            outputs = [outputs]

        ei_tag_path = None
        for out in outputs:
            dst_amz = out.get('dstPath', '')
            dst_app = container_to_host(dst_amz, amz_vols)
            # 作業フォルダの置き場を覚える（録画詳細で tmp_base 以外を直接指定した時のため。
            # 履歴から消える時・孤児の掃除がそこも探す）
            if dst_app:
                from logic.storage import work_bases
                work_bases.remember(os.path.dirname(os.path.dirname(dst_app.rstrip('/'))), tmp_base)
            stem = os.path.splitext(
                os.path.basename(encode_info.get('input_ts', 'input.ts'))
            )[0]
            ei_tag_path = os.path.join(dst_app or dst_amz, stem + '.tag.json')
            break

        # encodings.tag_json = コピー先パス（app_output_path.tag.json）
        app_out = _list_val(recording, 'app_output_path', i)
        fixed_out = _fix_folder_segment(app_out, _list_val(recording, 'folder', i),
                                        recording.get('app_output_path_format'))
        if fixed_out != app_out:
            logger.warning('run_make_db: recording_id=%d 出力パスのフォルダ段を確定値に合わせました: %s → %s',
                           recording_id, app_out, fixed_out)
            app_out = fixed_out
        tag_json_dst = (app_out + '.tag.json') if app_out else ei_tag_path

        # SKIP タグを含むセグメントはエンコード対象外
        if isinstance(episode_segs, str) and ',SKIP' in episode_segs:
            logger.info('run_make_db: recording_id=%d episode %d skipped (SKIP tag)', recording_id, i)
            continue

        drop_err = recording.get('drop_error')
        if not isinstance(drop_err, str):
            drop_err = json.dumps(drop_err) if drop_err is not None else None

        db.add_encoding(
            recording_id,
            order_index=i,
            episode_idx=i,
            episode_count=n,
            state='wait_encode',
            encode_info=json.dumps(encode_info),
            tag_json=tag_json_dst,
            title=_list_val(recording, 'title', i),
            folder=_list_val(recording, 'folder', i),
            category=_list_val(recording, 'category', i),
            furigana=_list_val(recording, 'furigana', i),
            drop_error=drop_err,
            sid=recording.get('sid'),
            eit_start_time=recording.get('eit_start_time'),
            eit_end_time=recording.get('eit_end_time'),
            comments_json=recording.get('comments_json'),
            captions_json=recording.get('captions_json'),
            captions2_json=recording.get('captions2_json'),
            episode_number=_list_val(recording, 'episode_number', i),
            episode_name=_list_val(recording, 'episode_name', i),
            segments=json.dumps(episode_segs) if episode_segs is not None else None,
            app_output_path=app_out,
            app_output_path_format=recording.get('app_output_path_format'),
            encode_dir=encode_dir,
            recording_start_time=recording.get('recording_start_time'),
            key_frames=recording.get('key_frames'),
        )

    logger.info('run_make_db: recording_id=%d inserted %d encodings', recording_id, n)
