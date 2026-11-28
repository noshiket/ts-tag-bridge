"""番組との結び付け・コメント・確定値・一時フォルダ・サムネ"""

import json
import random
import string
from datetime import datetime as _dt
from .parse import (  # noqa: F401
    logger,
)


def _link_program(db, rec_id: int, recording: dict) -> None:
    """program_id 未設定の録画を programs と照合して program_id を更新する。"""
    onid      = recording.get('onid')
    tsid      = recording.get('tsid')
    sid       = recording.get('sid')
    eid       = recording.get('eid')
    eit_start = recording.get('eit_start_time')

    if not any([onid, tsid, sid, eid, eit_start]):
        return

    # programs テーブルを reserve_key で検索
    if all(x is not None for x in (onid, tsid, sid, eid)):
        reserve_key = f'{onid}-{tsid}-{sid}-{eid}'
        prog = db.get_by_key(reserve_key)
        if prog:
            db.update_recording(rec_id, program_id=prog['id'])
            return

    # reserve_key が一致しない場合は sid + 開始時刻の近似で検索
    if sid and eit_start:
        try:
            eit_dt = _dt.fromisoformat(eit_start)
            for p in db.list_rules():
                parts = (p.get('reserve_key') or '').split('-')
                if len(parts) == 4 and str(parts[2]) == str(sid):
                    try:
                        if abs((_dt.fromisoformat(p['start_time']) - eit_dt).total_seconds()) <= 120:
                            db.update_recording(rec_id, program_id=p['id'])
                            return
                    except (ValueError, TypeError):
                        continue
        except (ValueError, TypeError):
            pass


def _gen_tmp_name() -> str:
    """年月日時刻 + ランダム英数字6文字のTMPディレクトリ名を生成する。"""
    ts = _dt.now().strftime('%Y%m%d%H%M')
    rand = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
    return ts + rand


def _gen_tmp_dirs(ep_count) -> list:
    """ep_count 分 TMPディレクトリ名を生成する。0/1件の場合は1つ。リスト内重複なし。"""
    n = ep_count if isinstance(ep_count, int) and ep_count >= 2 else 1
    seen = set()
    result = []
    while len(result) < n:
        name = _gen_tmp_name()
        if name not in seen:
            seen.add(name)
            result.append(name)
    return result


def _build_default_encode_info(server_url: str, config: dict) -> str | None:
    """config から server_url に対応する最初のエンコード設定を to_encode_info のデフォルト値として生成する。"""
    edcb_servers = config.get('edcb_servers') or []
    srv = next((s for s in edcb_servers if s.get('url') == server_url), None)
    if not srv:
        return None
    encode_list = srv.get('encode') or []
    if not encode_list:
        return None
    first_enc = encode_list[0]
    encode_type = first_enc.get('encode_type', '')
    encode_name = first_enc.get('name', '')
    encode_link = ''
    encode_preset = None
    if encode_type == 'amatsukaze_servers':
        amz_servers = config.get('amatsukaze_servers') or []
        amz_srv = next((s for s in amz_servers if s.get('name') == encode_name), None)
        if amz_srv:
            encode_link = amz_srv.get('url', '')
            presets = amz_srv.get('encode_preset') or []
            if presets:
                encode_preset = {k: v for k, v in presets[0].items() if k != 'name'}
    return json.dumps({
        'encode_type': encode_type,
        'encode_link': encode_link,
        'encode_preset': encode_preset,
    }, ensure_ascii=False)


def _calc_overlap(eit_start: str, eit_end: str, rec_start: str, rec_end: str):
    """EIT 放送時間と録画時間の重なり度合い (0.0〜1.0) を返す。計算不可なら None。"""
    if not all([eit_start, eit_end, rec_start, rec_end]):
        return None
    try:
        from datetime import datetime as _dt
        es = _dt.fromisoformat(eit_start)
        ee = _dt.fromisoformat(eit_end)
        rs = _dt.fromisoformat(rec_start)
        re = _dt.fromisoformat(rec_end)
        eit_dur = (ee - es).total_seconds()
        if eit_dur <= 0:
            return None
        if es < rs and re < ee:
            return (re - rs).total_seconds() / eit_dur
        elif rs < es and re < ee:
            return (re - es).total_seconds() / eit_dur
        elif es < rs and ee < re:
            return (ee - rs).total_seconds() / eit_dur
        elif ee < rs or re < es:
            return 0.0
        else:
            return 1.0
    except Exception:
        return None


def _apply_defaults(db, rec_id, config):
    """エンコードの既定値・出力先・ディスク登録・予約との紐付け。"""
    # ── to_encode_info デフォルト設定 ─────────────────────────────────────
    # to_encode_info 未設定 かつ server_url が定義済みの場合にデフォルトを生成
    recording = db.get_recording(rec_id)
    if recording.get('to_encode_info') is None:
        server_url = recording.get('server_url', '')
        if server_url:
            default_ei = _build_default_encode_info(server_url, config)
            if default_ei:
                db.update_recording(rec_id, to_encode_info=default_ei)

    # ── encode_dir デフォルト設定 ─────────────────────────────────────────
    # 未設定の場合: federation.library_peer が設定されたノード（＝送信側）なら
    # 予約値 'master'（エンコード完了時にライブラリサーバーへpushされる）を既定にする。
    # それ以外は従来どおり encode_dir_list の先頭を既定の出力先として登録（録画詳細で変更可）。
    if not recording.get('encode_dir'):  # None/空文字とも未設定扱い(空文字が実パスに化けるのを防ぐ)
        fed = config.get('federation') or {}
        if (fed.get('library_peer') or {}).get('url'):
            from logic.encode_pipeline.common import FED_MASTER
            db.update_recording(rec_id, encode_dir=FED_MASTER)
            recording['encode_dir'] = FED_MASTER
        else:
            enc_dirs = config.get('encode_dir_list') or []
            if enc_dirs:
                db.update_recording(rec_id, encode_dir=enc_dirs[0])
                recording['encode_dir'] = enc_dirs[0]

    # ── ディスク登録（外部ディスク取り外し検知用マーカー）─────────────────
    # encode_dir（出力先）とソースTSのディスクを disks レジストリに登録。
    # 外部ディスクならマウント点直下にマーカー(.encode_disk_id)を用意する。
    # encode_dir=='master'（実ディレクトリではない予約値）はディスク登録の対象外。
    try:
        from logic.storage.disk_guard import register_path_disk
        encode_dir_val = recording.get('encode_dir') or (config.get('encode_dir_list') or [None])[0]
        if encode_dir_val != 'master':
            register_path_disk(db, encode_dir_val)
        register_path_disk(db, recording.get('host_ts_path') or recording.get('app_ts_path'))
    except Exception as e:
        logger.warning('add_recording: recording_id=%d disk register failed: %s', rec_id, e)

    # ── programs 紐付け ────────────────────────────────────────────────────
    # 手動登録 / orphan など program_id 未設定の録画を、スキャンで確定した
    # reserve_key（onid-tsid-sid-eid）または sid+開始時刻の近似で programs と照合する。
    if recording.get('program_id') is None:
        _link_program(db, rec_id, recording)
