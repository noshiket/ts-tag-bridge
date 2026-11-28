"""古い programs / recordings の定期クリーンアップ — 予約の同期の tick 末尾から1時間毎に呼ばれる。

対象（保持日数 = config.program_retention_days、既定10。0/未設定型不正で全て無効）:
  (a) EDCB上でスキップ(recSetting.recEnabled=false)のまま放送期間(expected_end_time)が
      終了した programs。録画されることは無いので即削除する。EDCBから予約が消えた後の
      残骸は (b) の保持日数ルールが回収する。
  (b) expected_end_time が保持日数より古い programs。ただし recordings が紐づくものは
      削除しない（録画側のライフサイクル (c) に任せる。消すと録画一覧のrule結合情報が
      失われるため）。
  (c) 放送開始(eit_start_time、無ければcreated_at)が保持日数より古く、参照元TSファイルが
      実在しない recordings。パスが空のもの(EDCBが録画に失敗しファイルが出来なかった
      state=non_file 等)も「実在しない」に含める。子 encodings（+tmp_dir）→ recording 行（+サムネ等ファイル）の
      順に削除し、delete_recording の孤児判定で親 program も一緒に消える。
      EDCB の録画済み情報(rec_info)は残し、ignore_rec_id で録画の見張り（手順0） の再取込のみ防ぐ
      （encode_history.py / cleanup_missing_files と同じ方針）。

注意:
  - rule_db は PRAGMA foreign_keys を有効化していないため ON DELETE CASCADE は効かない。
    カスケードは全てここで手動に行う。
  - ファイル存在判定は stale になりうる recordings.file_exist 列ではなくライブの
    os.path.exists() を使い、db.disk_offline() で外付けディスク未マウント時の誤削除を防ぐ。
  - api.routes の _rec_aug_cache はワーカースレッドから安全に無効化できないが、
    TTL 35秒で自己回復するため放置でよい。
"""

import logging
import os
from datetime import datetime, timedelta


from logic.encoding.encode_history import _delete_recording_files, _prune_one, delete_recording_tmp_dirs
from .tmp_dir_cleanup import _purge_orphan_tmp_dirs

logger = logging.getLogger(__name__)


def cleanup_stale(db, config: dict, reserves: list) -> dict:
    """古いprograms/recordingsを削除して件数dictを返す。reservesは予約の同期が取得済みの
    enum_reserve_info結果（(a)のスキップ判定に使う。EDCB取得失敗時は呼び出し元の
    _tickが先に例外で落ちるため、ここへ空・不正データで到達することはない）。"""
    days = config.get('program_retention_days', 10)
    if not isinstance(days, int) or isinstance(days, bool) or days <= 0:
        return {}
    now_iso = datetime.now().isoformat()
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    counts = {'skip_programs': 0, 'old_programs': 0, 'old_recordings': 0}

    # (a) スキップのまま放送期間が終了した programs
    skip_ids = {r['reserveID'] for r in reserves
                if r.get('reserveID') is not None
                and not (r.get('recSetting') or {}).get('recEnabled', True)}
    # (b) と合わせて一度だけ全ルールを取得して振り分ける
    for rule in db.list_rules():
        rule_id = rule['id']
        end = rule.get('expected_end_time') or ''
        try:
            if rule.get('reserve_id') in skip_ids and end and end < now_iso:
                if db.get_recordings(rule_id):
                    continue  # 防御: スキップ予約に録画は無いはずだが、あれば触らない
                db.delete_rule(rule_id)
                counts['skip_programs'] += 1
                logger.info('cleanup: program %d "%s" removed (skip reserve, ended)',
                            rule_id, rule.get('original_title') or '')
            elif end and end < cutoff:
                if db.get_recordings(rule_id):
                    continue  # 録画が紐づくものは (c) に任せる
                db.delete_rule(rule_id)
                counts['old_programs'] += 1
        except Exception as e:
            logger.error('cleanup: program %s failed: %s', rule_id, e)

    # (c) 放送開始が古く、参照元TSが実在しない recordings
    tmp_base = config.get('tmp_base', '') or ''
    for rec in db.list_recordings():
        rec_db_id = rec['id']
        try:
            ts = rec.get('eit_start_time') or rec.get('created_at') or ''
            if not ts or ts >= cutoff:
                continue
            path = rec.get('host_ts_path') or ''
            # パス無し(state=non_file 等、EDCBが録画に失敗してファイルが出来なかったもの)も
            # 「ファイル無し」として扱う。保持日数より古いことは上で確認済みなので、
            # まだパスが入っていない録画中の行を巻き込むことはない。
            if path:
                if os.path.exists(path):
                    continue
                if db.disk_offline(path):
                    continue  # 外付けディスク取り外し中は「消失」と誤判定しない
            encs = db.get_encodings(rec_db_id)
            if encs:
                # 子encodingごとにtmp_dir+行を削除。最後の1件で_prune_oneが
                # 録画ファイル(サムネ等)削除+ignore_rec_id+delete_recordingまで行い、
                # delete_recordingの孤児判定で親programも消える。
                for enc in encs:
                    _prune_one(db, enc, tmp_base, config)
            else:
                full = db.get_recording(rec_db_id)  # list_recordingsはlight列のため取り直す
                if not full:
                    continue
                delete_recording_tmp_dirs(full, tmp_base)  # 行を消す前に tmp_dir を回収する
                _delete_recording_files(full)
                rid = full.get('rec_id')
                if rid is not None:
                    db.ignore_rec_id(rid)  # EDCBは残しB-0再取込のみ防ぐ
                db.delete_recording(rec_db_id)
            counts['old_recordings'] += 1
            logger.info('cleanup: recording %d removed (file missing, older than %dd)',
                        rec_db_id, days)
        except Exception as e:
            logger.error('cleanup: recording %s failed: %s', rec_db_id, e)

    # (d) どの encodings からも参照されていない tmp ディレクトリ（孤児）
    # 録画やencodingsを消した後にトークンだけ失われて実体が残る経路があり、
    # 1本あたり数GB〜数十GBのため放置すると tmp_base を食い潰す（実測 154GB）。
    counts['orphan_tmp_dirs'] = _purge_orphan_tmp_dirs(db, tmp_base)

    # (e) 副音声版ダウンロードの一時 MP4 のうち、完了通知が来ず残ったもの（TTL 超過）
    try:
        from api.routes.media import purge_secondary_audio_cache
        counts['secondary_audio_files'] = purge_secondary_audio_cache(tmp_base)
    except Exception as e:
        logger.warning('cleanup: secondary_audio purge failed: %s', e)
    # アドオンが利用者へ渡すファイル（切り抜きの MP4 など）。ダウンロードされた分は
    # 送信完了時に消えるので、ここで拾うのは取りに来られなかった分だけ
    try:
        from logic.addons import addon_outputs
        counts['addon_output_files'] = sum(addon_outputs.purge_outputs().values())
    except Exception as e:
        logger.warning('cleanup: addon outputs purge failed: %s', e)

    return counts
