"""受け取った録画を仕上げる（名前を安全にして置き、登録する）"""

import asyncio
import json
import os
import shutil
from quart import current_app, jsonify, request
from .common import _safe_transfer_id, fed_bp, logger
from .manifest import _load_manifest
from .ingest_dedup import _meta_rest
from .recording_paths import _default_recv_dir, _find_existing_by_event, _recording_staging_root


# exFAT/NTFS が受け付けない文字。受け入れ先がその手のディスクだと、番組名に
# これが入っているだけで finalize が [Errno 22] で落ち、何度送り直しても同じ所で
# 失敗し続ける。実測:
#   /mnt/exfat/raw/〇〇〇 大丈夫なの!?Ver. #13 ….ts
#   → [Errno 22] Invalid argument（'?' が原因）
_FS_BAD_CHARS = '\\/:*?"<>|'


_FS_SAFE_MAP = str.maketrans({c: '_' for c in _FS_BAD_CHARS if c != '/'})


def _fs_safe_name(recv_dir: str, name: str) -> str:
    """受け入れ先のディスクで作れない文字を置き換える。作れるなら元のまま。

    ext4 では '?' も作れるので、置き換えると母艦と名前が食い違う。実際に
    作ってみて、駄目だった時だけ置き換える。
    """
    bad = [c for c in _FS_BAD_CHARS if c in name]
    if not bad:
        return name
    # 試作の名前には**引っかかっている文字そのもの**を入れる。末尾を切り出すと
    # 肝心の文字が落ちて試作が成功し、元の名前のまま進んでしまう
    # （実測: '…大丈夫なの!?Ver. #13 -202609280930.ts' の末尾24文字に
    #  '?' が入らず、直したつもりが同じ [Errno 22] で落ち続けた）。
    probe = os.path.join(recv_dir, f'.fedprobe-{os.getpid()}-{"".join(bad)}')
    try:
        with open(probe, 'wb'):
            pass
        os.unlink(probe)
        return name                      # このディスクはそのまま作れる
    except OSError:
        pass
    safe = name.translate(_FS_SAFE_MAP)
    logger.info('fed finalize: 受け入れ先のディスクが使えない文字を含むので'
                '名前を変えます: %s → %s', name, safe)
    return safe


def _recording_transfer_finalize_sync(cfg: dict, rule_db, tdir: str, manifest: dict,
                                      meta: dict) -> dict:
    """録画転送 finalize の本体: TSを既存録画と同じ場所へ配置し、通常録画として登録して
    エンコード設定を反映し自動キュー投入する。"""
    from logic.encode_pipeline.runner.create import create_encodings
    from logic.encode_pipeline.base.context import _update_recording_rollup
    from logic.storage.path_translator import host_to_container

    # 冪等: 同一番組の既存録画があれば作り直さない(startで弾くがfinalize再送にも備える)。
    #
    # ただし「何もしない」で返してはいけない。前回の転送が途中で落ちて行だけ
    # 作られていると、送り直しても中身が埋まらないまま残る（実際 cm_analysis や
    # text_parser_result が空のまま残った）。空いている列だけ埋める。既に値が
    # 入っている列は触らない＝向こうで手を入れたものを上書きしない。
    existing = _find_existing_by_event(rule_db, meta)
    if existing:
        shutil.rmtree(tdir, ignore_errors=True)
        filled = {k: v for k, v in _meta_rest(rule_db, meta).items()
                  if existing.get(k) in (None, '')}
        if filled:
            rule_db.update_recording(existing['id'], **filled)
            logger.info('fed recording: 既存 rec_id=%d の空き列を埋めた (%d列: %s)',
                        existing['id'], len(filled), ', '.join(sorted(filled)))
        return {'recording_id': existing['id'], 'already': True,
                'filled': sorted(filled)}

    ts_name = manifest['files'][0]['name']
    staged_ts = os.path.join(tdir, ts_name)
    if not os.path.exists(staged_ts):
        raise FileNotFoundError(f'受信TSがありません: {ts_name}')

    inner = meta.get('to_encode_info') or {}
    if not inner.get('encode_type') or not inner.get('encode_preset'):
        raise ValueError('meta.to_encode_info(エンコード設定) が不完全です')

    # TSを既存録画と同じフォルダへ移動(スレーブでは通常の録画になる)
    recv_dir = _default_recv_dir(cfg, rule_db)
    os.makedirs(recv_dir, exist_ok=True)
    ts_name = _fs_safe_name(recv_dir, ts_name)
    dest_ts = os.path.join(recv_dir, ts_name)
    if os.path.exists(dest_ts):
        base, ext = os.path.splitext(ts_name)
        dest_ts = os.path.join(recv_dir, f'{base}.fed{ext}')
    shutil.move(staged_ts, dest_ts)

    # amatsukaze_ts_path 用の volumes(エンコード設定の encode_link で解決)
    amz_servers = cfg.get('amatsukaze_servers', [])
    amz_cfg = next((s for s in amz_servers if s.get('url') == inner.get('encode_link')),
                   amz_servers[0] if amz_servers else {})
    amz_vols = amz_cfg.get('volumes', [])

    rec_id = rule_db.add_recording(
        None, None,
        onid=meta.get('onid'), tsid=meta.get('tsid'),
        sid=meta.get('sid'), eid=meta.get('eid'),
        host_ts_path=dest_ts, app_ts_path=dest_ts,
        amatsukaze_ts_path=host_to_container(dest_ts, amz_vols),
        eit_start_time=meta.get('eit_start_time'), eit_end_time=meta.get('eit_end_time'),
        eit_title=meta.get('eit_title'), eit_description=meta.get('eit_description'),
        eit_extended_info=meta.get('eit_extended_info'),
        eit_station_name=meta.get('eit_station_name'),
        eit_genre=meta.get('eit_genre'), eit_video_info=meta.get('eit_video_info'),
        eit_audio_info=meta.get('eit_audio_info'),
        file_exist=1, file_size=meta.get('file_size'),
        duration_sec=meta.get('duration_sec'),
        drop_error=meta.get('drop_error'),
        recording_start_time=meta.get('recording_start_time'),
        recording_end_time=meta.get('recording_end_time'),
        title=meta.get('title'), folder=meta.get('folder'),
        episode_number=meta.get('episode_number'), episode_name=meta.get('episode_name'),
        category=meta.get('category'), furigana=meta.get('furigana'),
        app_output_path=meta.get('app_output_path'),
        app_output_path_format=meta.get('app_output_path_format'),
        server_url=meta.get('server_url'),
    )
    # add_recording は state='pending' 固定 → スキャン不要(マスターでスキャン済み)なので
    # waiting に確定し、確定値と設定を反映する
    rule_db.update_recording(
        rec_id, state='waiting',
        segments=meta.get('segments'),
        to_encode_info=json.dumps(inner, ensure_ascii=False),
        encode_dir=meta.get('encode_dir') or 'master',
        comments_json=meta.get('comments_json'),
        captions_json=meta.get('captions_json'),
        captions2_json=meta.get('captions2_json'),
        key_frames=meta.get('key_frames'),
    )

    # 送り側が付けてきた残りの列をそのまま入れる。
    #
    # 個別に並べていると、列が増えた時に取りこぼす。実際 text_parser_result /
    # frame_table / cm_analysis / probe_result が漏れていて、転送先では
    # 「厳密フレームが出ない」「text_parser を再解析しないといけない」状態に
    # なっていた（EITスキャンからやり直す羽目になる）。
    # 送り側は _TRANSFER_SKIP_COLS 以外を全部送ってくるので、ここでは
    # 「この行で既に決めたもの」だけを守り、残りは素通しでよい。
    rest = _meta_rest(rule_db, meta)
    if rest:
        rule_db.update_recording(rec_id, **rest)


    # 「転送だけ」(auto_queue=False)はキューに載せず waiting のまま置く。
    # エンコード委譲と違って押し戻す成果物が無いので、向こうの判断に任せる。
    queued = meta.get('auto_queue') is not False
    if queued:
        # 自動キュー投入(以降は完全に通常のローカルエンコード)
        rule_db.update_recording(rec_id, state='queued')
        create_encodings(rule_db, rec_id, cfg)
        priority = meta.get('priority')
        if isinstance(priority, int) and 1 <= priority <= 5 and priority != 3:
            for e in rule_db.get_encodings(rec_id):
                rule_db.update_encoding(e['id'], priority=priority)
    _update_recording_rollup(rule_db, rec_id)
    # サムネは送られてこないので、受け取った TS から作る（別のスレッドで）
    from logic.federation import received_thumbnail
    received_thumbnail.start(rule_db, rec_id, dest_ts, meta, cfg)

    shutil.rmtree(tdir, ignore_errors=True)
    logger.info('fed recording: 受信完了 rec_id=%d ts=%s → %s',
                rec_id, dest_ts, 'キュー投入' if queued else '転送のみ(waiting)')
    return {'recording_id': rec_id}


@fed_bp.post('/recording/<transfer_id>/finalize')
async def recording_transfer_finalize(transfer_id):
    """受け取った録画を登録する。body: {meta（番組の情報など）}。"""
    if not _safe_transfer_id(transfer_id):
        return jsonify({'error': '不正な transfer_id です'}), 400
    body = await request.get_json()
    meta = (body or {}).get('meta')
    if not isinstance(meta, dict):
        return jsonify({'error': 'meta が不正です'}), 400
    tdir = os.path.join(_recording_staging_root(), transfer_id)
    manifest = await asyncio.to_thread(_load_manifest, tdir)
    if manifest is None:
        return jsonify({'error': 'transfer_id が見つかりません'}), 404
    cfg = current_app.config['ENCODE_AUTO']
    rule_db = current_app.config['RULE_DB']
    try:
        result = await asyncio.to_thread(
            _recording_transfer_finalize_sync, cfg, rule_db, tdir, manifest, meta)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.warning('fed recording finalize failed transfer_id=%s: %s', transfer_id, e)
        return jsonify({'error': str(e)}), 500
    logger.info('fed recording finalize: transfer_id=%s → %s', transfer_id, result)
    return jsonify(result)
