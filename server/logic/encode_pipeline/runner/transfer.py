"""エンコードを任せる先への録画の転送と、止まった転送のやり直し"""

import json
import os
from datetime import datetime
from typing import Optional
import requests
from logic.federation import fed_auth
from ..common import (  # noqa: F401
    logger,
)


# ノード委譲エンコーダーの encode_type 前置(例: 'node:node2')
# 録画そのもの(TS+メタ)を federation.remote_nodes のスレーブへ転送し、
# スレーブ側で通常録画として自動キュー投入させる(録画転送型)
NODE_ENCODER_PREFIX = 'node:'


def _node_encoder_name(encode_type: str) -> Optional[str]:
    """encode_type が 'node:<name>' ならノード名を返す。違えば None。"""
    if isinstance(encode_type, str) and encode_type.startswith(NODE_ENCODER_PREFIX):
        return encode_type[len(NODE_ENCODER_PREFIX):] or None
    return None


# 転送してはいけない recordings の列。
#
# ここに載っていない列は全部そのまま送る。個別に列挙する形にしていると、列を
# 足すたびに転送し忘れる（実際 text_parser_result / frame_table / cm_analysis /
# probe_result が漏れていて、受け側で「厳密フレームが出ない」「text_parser を
# 再解析しないといけない」状態になっていた）。
_TRANSFER_SKIP_COLS = frozenset({
    # 受け側が自分で決めるもの
    'id', 'state', 'file_exist', 'created_at', 'updated_at',
    # このサーバー固有のパス
    'edcb_ts_path', 'host_ts_path', 'app_ts_path', 'amatsukaze_ts_path',
    'konomitv_ts_path', 'output_path', 'thumbnail_path', 'thumbnail_tile_path',
    # サムネの寸法等。実体(上のパス)を送らないので持たせても嘘になる
    'thumbnail_info',
    # このサーバーの中でしか意味を持たない参照
    'program_id', 'rec_id', 'auto_add_id', 'shimakaze_job_id',
    # このサーバー側の作業状態
    'error_message', 'cm_error', 'scan_cancelled', 'tmp_dirs', 'transfer_state',
    # 手元のライブラリと突き合わせた結果。受け側で意味が変わる
    'duplicate_info',
    # 受け側からさらに転送させない
    'auto_send',
    # 呼び出し側が明示的に決める
    'to_encode_info', 'encode_dir',
})


def _blank(v) -> bool:
    return v in (None, '', '{}', '[]', 'null') or v == {} or v == []


def _program_fallback(db, recording: dict) -> dict:
    """録画に解析結果が無い時に、予約（programs）の解析結果とエラー。

    録画詳細は、録画に解析結果が無ければ予約のものを出す。予約へのつながり（program_id）は
    送らないので、送った先では解析結果・タグ・確定値の元が無く、録画詳細が空になっていた。
    """
    if not _blank(recording.get('text_parser_result')) or not recording.get('program_id'):
        return {}
    prog = db.get_rule(recording['program_id']) or {}
    out = {}
    tpr = prog.get('text_parser_result')
    if not _blank(tpr):
        out['text_parser_result'] = tpr if isinstance(tpr, str) else json.dumps(tpr, ensure_ascii=False)
    if not _blank(prog.get('parser_error')) and _blank(recording.get('parser_error')):
        out['parser_error'] = prog.get('parser_error')
    return out


def transfer_recording_to_node(db, recording_id: int, config: dict, node_name: str,
                               priority: int = 3, encode: bool = True) -> None:
    """録画そのもの(TS+メタ)をスレーブへ転送し、スレーブ側で自動キュー投入させる。

    encode=False は「転送だけ」。相手のエンコード設定は要らず、向こうでは waiting の
    まま置かれる（キューには載らない）。マスター側の録画とTSはそのまま残るので、
    要らなければ録画詳細から消す。エンコード委譲と違って押し戻される成果物が無く、
    自動で消す判断材料が無いため。

    queue_recording の node: 分岐からバックグラウンドスレッドで呼ばれる。
    マスター側の録画行の state は変えない(スレーブ側 create_encodings の通知で
    waiting(<node>) になる)。失敗時は error_message をセットする。
    エンコード完了後はスレーブの push + 既存 _dedup_master_duplicates により
    マスター側の録画+TSが自動削除される。
    """
    from clients.fed_node_client import FedNodeClient

    recording = db.get_recording(recording_id)
    if not recording:
        return
    fed = config.get('federation') or {}
    node_cfg = next((n for n in (fed.get('remote_nodes') or [])
                     if n.get('name') == node_name and n.get('url')), None)
    if node_cfg is None:
        db.update_recording(recording_id,
                            error_message=f'連携ノード {node_name} が設定にありません')
        return

    to_encode_raw = recording.get('to_encode_info') or '{}'
    to_encode = json.loads(to_encode_raw) if isinstance(to_encode_raw, str) else to_encode_raw
    inner = to_encode.get('encode_preset') or {}
    if encode and (not inner.get('encode_type') or not inner.get('encode_preset')):
        db.update_recording(recording_id,
                            error_message='スレーブ側のエンコード設定が未完了です')
        return

    ts_path = recording.get('app_ts_path') or ''
    if not ts_path or not os.path.exists(ts_path):
        db.update_recording(recording_id,
                            error_message=f'転送対象のTSがありません: {ts_path}')
        return

    drop_error = recording.get('drop_error')
    if isinstance(drop_error, (dict, list)):
        drop_error = json.dumps(drop_error, ensure_ascii=False)

    # 行をまるごと送る（送ってはいけない列だけ除く）。列が増えても勝手に付いていく
    meta = {k: v for k, v in dict(recording).items() if k not in _TRANSFER_SKIP_COLS}
    meta.update({
        'to_encode_info': inner,
        'encode_dir': 'master',   # 成果物は既存 push でマスターへ返送させる
        'priority': priority,
        'drop_error': drop_error,  # 上でリスト→JSON文字列に直したもの
        # 転送だけの時は向こうでキューに載せない（waiting のまま置く）
        'auto_queue': bool(encode),
    })
    meta.update(_program_fallback(db, recording))

    transfer_id = f"rec-{fed.get('node_id') or 'master'}-{recording_id}"
    client = FedNodeClient(node_cfg, fed_auth.token_for_peer(config, node_cfg))
    logger.info('transfer_recording_to_node: rec=%d → %s 転送開始 (%s, %.1f GB)',
                recording_id, node_name, ts_path, os.path.getsize(ts_path) / 1e9)

    # 転送の進み具合を録画行へ残す。転送中は state を変えない設計なので、
    # これが無いと数GB送っている間「何も起きていない」ようにしか見えない
    started = datetime.now().isoformat()

    def _save(phase, sent=0, total=0, error=None):
        try:
            db.update_recording(recording_id, transfer_state=json.dumps({
                'node': node_name, 'phase': phase, 'sent': sent, 'total': total,
                'started_at': started, 'updated_at': datetime.now().isoformat(),
                'error': error, 'priority': priority,
            }, ensure_ascii=False))
        except Exception as e:
            logger.debug('transfer_recording_to_node: 進み具合の保存に失敗(無視): %s', e)

    _save('starting', 0, os.path.getsize(ts_path))
    try:
        result = client.transfer_recording(transfer_id, ts_path, meta, on_progress=_save)
    except (requests.ConnectionError, requests.Timeout,
            requests.exceptions.ChunkedEncodingError) as e:
        # 繋がらなかった・途中で切れた・待っても応答が無い。中身の問題ではないので
        # 送り直せば直る。'error' で終端にすると誰も再開せず録画が waiting のまま
        # 止まる(実測: 受け側の再起動で切れ、そのまま放置された)。
        # 相手がHTTPで拒否した場合(HTTPError)は中身の問題なので下の error 側へ流す。
        logger.error('transfer_recording_to_node: rec=%d 転送が切れました: %s', recording_id, e)
        _save('interrupted', error=str(e)[:300])
        db.update_recording(recording_id, error_message=f'{node_name}への転送が切れました: {e}')
        return
    except Exception as e:
        logger.error('transfer_recording_to_node: rec=%d 転送失敗: %s', recording_id, e)
        _save('error', error=str(e)[:300])
        db.update_recording(recording_id, error_message=f'{node_name}への転送失敗: {e}')
        return
    _save('done', os.path.getsize(ts_path), os.path.getsize(ts_path))
    db.update_recording(recording_id, error_message=None)
    logger.info('transfer_recording_to_node: rec=%d → %s 完了 %s',
                recording_id, node_name, result)
