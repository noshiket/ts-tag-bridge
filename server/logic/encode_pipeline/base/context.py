"""一時フォルダ・動画DB・エンコードの文脈・録画のまとめ"""

import data_paths  # server/ と server/data の場所
import json
import os
from typing import Optional
from logic.storage.path_translator import to_container_path
from ..common import FED_MASTER


# ===========================================================================
# Step 2: run_split_ts
# ===========================================================================


_video_db = None


def _get_video_db():
    """video.db への接続（VideoDB）をモジュール内で再利用する。worker スレッドから
    呼ばれるため app.config は使わず、data/video.db を直接開く（WAL・スレッドローカル接続）。"""
    global _video_db
    if _video_db is None:
        from db.video_db.core import VideoDB
        _video_db = VideoDB(os.path.join(data_paths.DATA_DIR, 'video.db'))
    return _video_db


# ===========================================================================
# メイン
# ===========================================================================

# アドオンエンコーダーの encode_type 前置(例: 'addon:ffmpeg_encode')
ADDON_ENCODER_PREFIX = 'addon:'


def _addon_encoder_name(encode_type: str) -> Optional[str]:
    """encode_type が 'addon:<name>' ならアドオン名を返す。違えば None。"""
    if isinstance(encode_type, str) and encode_type.startswith(ADDON_ENCODER_PREFIX):
        return encode_type[len(ADDON_ENCODER_PREFIX):] or None
    return None


def _addon_encode_preset(to_encode_info: dict, config: dict) -> dict:
    """アドオンエンコーダー用の encode_preset を合成する。

    アドオンはAmatsukazeのプリセット(input_ts/outputs/mode)を持たないが、
    run_make_db/run_split_ts はこのスキーマ(tmp配下のcut.ts と outputs.dstPath)を
    前提に動くため、tmp_base から既定値を組み立てて共通ステップを流用する。
    UIが保存するアドオン固有の入力値は 'params' に入る(そのまま温存する)。
    """
    preset = dict(to_encode_info.get('encode_preset') or {})
    tmp_base = (config.get('tmp_base') or '/tmp').rstrip('/')
    preset.setdefault('input_ts', f'{tmp_base}/{{$tmp_dirs}}/cut.ts')
    outputs = preset.get('outputs')
    if not outputs:
        preset['outputs'] = {'dstPath': f'{tmp_base}/{{$tmp_dirs}}/output'}
    preset.setdefault('params', {})
    return preset


def _resolve_encode_context(recording: dict, config: dict) -> Optional[dict]:
    """recordings.to_encode_info + config からエンコード実行コンテキストを解決する。

    to_encode_info が無ければ None を返す。
    """
    to_encode_raw = recording.get('to_encode_info')
    if not to_encode_raw:
        return None
    to_encode_info = json.loads(to_encode_raw) if isinstance(to_encode_raw, str) else to_encode_raw

    encode_type = to_encode_info.get('encode_type', '')
    amz_url = to_encode_info.get('encode_link', '')
    amz_servers = config.get('amatsukaze_servers', [])
    if _addon_encoder_name(encode_type):
        # アドオンエンコーダーはAmatsukazeを使わないため、amz設定へフォールバックしない
        # (volumes無し=パス変換なし。cut.ts等は全てホストの実パスで扱う)
        amz_cfg = {}
    else:
        amz_cfg = next((s for s in amz_servers if s.get('url') == amz_url),
                       amz_servers[0] if amz_servers else {})

    tmp_dirs_raw = recording.get('tmp_dirs')
    tmp_dirs = json.loads(tmp_dirs_raw) if isinstance(tmp_dirs_raw, str) else (tmp_dirs_raw or [])

    return {
        'encode_type':       encode_type,
        'encode_preset_tpl': (_addon_encode_preset(to_encode_info, config)
                              if _addon_encoder_name(encode_type)
                              else to_encode_info.get('encode_preset', {})),
        'amz_url':           amz_url,
        'amz_vols':          amz_cfg.get('volumes', []),
        'tmp_dirs':          tmp_dirs,
        'source_ts_app':     recording.get('app_ts_path', ''),
        'encode_dir':        recording.get('encode_dir') or _default_encode_dir(config),
    }


def _default_encode_dir(config: dict) -> Optional[str]:
    """encode_dir未設定(None/'')時の既定値。federation送信側(library_peer設定済み)は
    FED_MASTER、それ以外はencode_dir_listの先頭(add_recordingの既定と同一ロジック)。"""
    fed = config.get('federation') or {}
    if (fed.get('library_peer') or {}).get('url'):
        return FED_MASTER
    return (config.get('encode_dir_list') or [None])[0]


def _update_recording_rollup(db, recording_id: int) -> None:
    """encodings の状態から recordings.state を集計（rollup）して更新する。

    - pending（encode_end / encode_error 以外）が残る:
        wait_encode 以外があれば 'encoding'、全て wait_encode なら 'queued'
    - pending なし: error があれば 'encode_error'、無ければ 'encode_finish'
    encodings が 1 件も無ければ何もしない。
    """
    encs = db.get_encodings(recording_id)
    if not encs:
        return
    pending = [e for e in encs if e.get('state') not in ('encode_end', 'encode_error')]
    if not pending:
        if any(e.get('state') == 'encode_error' for e in encs):
            db.update_recording(recording_id, state='encode_error')
        else:
            db.update_recording(recording_id, state='encode_finish')
        return
    if any(e.get('state') != 'wait_encode' for e in pending):
        db.update_recording(recording_id, state='encoding')
    else:
        db.update_recording(recording_id, state='queued')


def _to_container_paths(encode_info: dict, amz_vols: list) -> bool:
    """input_ts / outputs.dstPath がホストのパスで書かれていればコンテナ内パスに直す。直したら True。"""
    changed = False
    p = encode_info.get('input_ts')
    if isinstance(p, str) and p:
        q = to_container_path(p, amz_vols)
        if q != p:
            encode_info['input_ts'] = q
            changed = True
    outputs = encode_info.get('outputs')
    for out in (outputs if isinstance(outputs, list) else [outputs] if isinstance(outputs, dict) else []):
        p = out.get('dstPath') if isinstance(out, dict) else None
        if isinstance(p, str) and p:
            q = to_container_path(p, amz_vols)
            if q != p:
                out['dstPath'] = q
                changed = True
    return changed
