"""状態・サーバーの設定・接続の確かめ・再起動"""

import os
import shutil

import data_paths
from boot.ports import listen_port
from logic.encoding import load_weights
from logic.federation.access_urls import access_urls
from logic.storage.work_bases import tmp_bases
from quart import jsonify, current_app
from api.routes.auth import bp  # noqa: F401
from .config_keys import _SECRET_MASK


# ---------------------------------------------------------------------------
# ワーカー状態
# ---------------------------------------------------------------------------

@bp.get('/status')
def status():
    """サーバーの見張り（予約の同期・録画の見張り・走査・エンコード）が動いているか、最後に動いた時刻とエラー。"""
    workers_cfg = current_app.config.get('WORKERS', {})
    reserve_sync = workers_cfg.get('reserve_sync')
    recording_watch = workers_cfg.get('recording_watch')
    recording_scan = workers_cfg.get('recording_scan')
    encode_runner = workers_cfg.get('encode_runner')

    def _worker_info(w):
        if w is None:
            return None
        return {
            'alive':      w.is_alive(),
            'last_run':   w.last_run,
            'last_error': w.last_error,
        }

    return jsonify({
        'status': 'ok',
        'workers': {
            # 応答のキーは昔の呼び名のまま（画面・アプリが読む）。
            # phase_a=予約の同期 / phase_b=録画の見張り / phase_b_scan=録画の走査 / phase_c=エンコードの実行
            'phase_a': _worker_info(reserve_sync),
            'phase_b': _worker_info(recording_watch),
            'phase_b_scan': _worker_info(recording_scan),
            'phase_c': _worker_info(encode_runner),
        },
    })


def _tool_candidates(name: str) -> dict:
    """同梱版（thirdparty/FFmpeg）とシステムの物（PATH）の場所。無ければ空。"""
    bundled = os.path.join(data_paths.SERVER_DIR, 'thirdparty', 'FFmpeg', name)
    return {'bundled': bundled if os.path.isfile(bundled) else '', 'system': shutil.which(name) or ''}


@bp.get('/config')
def get_config():
    """サーバーの設定（秘密の値は伏せる）。設定の画面が読む。管理者だけ。"""
    config = current_app.config['ENCODE_AUTO']
    # ruamel.yaml の CommentedMap/Seq をプレーンに変換
    import json as _j
    safe = _j.loads(_j.dumps({
        'port': listen_port(config),
        'host': config.get('host', '0.0.0.0'),
        'https': config.get('https') or {},
        'ffmpeg': config.get('ffmpeg', 'ffmpeg'),
        'ffprobe': config.get('ffprobe', 'ffprobe'),
        'edcb_servers': config.get('edcb_servers') or [],
        'amatsukaze_servers': config.get('amatsukaze_servers') or [],
        'services': config.get('services') or {},
        'volumes': config.get('volumes') or [],
        'tmp_base': config.get('tmp_base', ''),
        # 作業ディレクトリの候補（優先順）。TS 分割の時に空きが足りなければ次を使う
        'tmp_base_list': tmp_bases(config),
        'output_path': config.get('output_path', ''),
        'encode_dir_list': config.get('encode_dir_list') or [],
        'text_parser_context': config.get('text_parser_context') or {},
        'phase_a_interval': config.get('phase_a_interval', 120),
        'phase_b_interval': config.get('phase_b_interval', 60),
        'phase_b_scan_interval': config.get('phase_b_scan_interval', 30),
        'phase_c_interval': config.get('phase_c_interval', 30),
        'phase_b_defer_recordings': config.get('phase_b_defer_recordings', 2),
        'phase_b_defer_during_encode': bool(config.get('phase_b_defer_during_encode', False)),
        'drop_debug': bool(config.get('drop_debug', False)),
        'log_debug': bool(config.get('log_debug', False)),
        'log_file': bool(config.get('log_file', False)),
        'log_file_path': config.get('log_file_path') or '',
        # フッターのミニプレイヤーの高さ(px)。空欄なら既定の 64
        'mini_player_height': config.get('mini_player_height') or '',
        # データの置き場（空なら server/data）。今使っている場所も返す（再起動するまで変わらない）
        'data_dir': config.get('data_dir') or '',
        'data_dir_in_use': data_paths.DATA_DIR,
        # 解析の重さ（控えめ・ふつう・全力）と、数字で決める時の値（空欄なら重さで決まる）
        'cmcut_weight': load_weights.weight_of(config, 'cmcut_weight'),
        'audio_sync_weight': load_weights.weight_of(config, 'audio_sync_weight'),
        'cmcut_workers': config.get('cmcut_workers') or '',
        'cmcut_nice': '' if config.get('cmcut_nice') is None else config.get('cmcut_nice'),
        'cmcut_max_load': config.get('cmcut_max_load') or '',
        'audio_sync_nice': '' if config.get('audio_sync_nice') is None else config.get('audio_sync_nice'),
        'audio_sync_max_load': config.get('audio_sync_max_load') or '',
        # 数字を空欄にした時に使う値（重さごと。並列数と負荷はこのサーバーの CPU 数で決まる）。画面が薄い字で出す
        'load_weight_presets': {w: {'cmcut': load_weights.cmcut_params({'cmcut_weight': w}),
                                    'audio_sync': load_weights.audio_sync_params({'audio_sync_weight': w})}
                                for w in load_weights.WEIGHTS},
        # ffmpeg・ffprobe の候補（同梱版・システムの物）。画面はこれで「どれを使うか」を選ばせる
        'tool_paths': {k: _tool_candidates(k) for k in ('ffmpeg', 'ffprobe')},
        # 相手のサーバーやスマホからこのサーバーへ入れる URL（連携の手順に出す）
        'access_urls': access_urls(config),
        'auto_skip_duplicates': bool(config.get('auto_skip_duplicates', False)),
        'encode_history_limit': config.get('encode_history_limit', 0),
        'program_retention_days': config.get('program_retention_days', 10),
        'streaming': config.get('streaming') or {},
        'federation': config.get('federation') or {},
    }))
    # シークレットは平文を返さずマスクする
    safe['jwt_secret'] = _SECRET_MASK if config.get('jwt_secret') else ''
    fed = safe.get('federation') or {}
    fed['fed_token'] = _SECRET_MASK if (config.get('federation') or {}).get('fed_token') else ''
    # ピアごとのトークンも同様にマスクする（設定済みかどうかだけ分かればよい）
    if isinstance(fed.get('library_peer'), dict) and fed['library_peer'].get('fed_token'):
        fed['library_peer'] = {**fed['library_peer'], 'fed_token': _SECRET_MASK}
    if isinstance(fed.get('remote_nodes'), list):
        fed['remote_nodes'] = [{**n, 'fed_token': _SECRET_MASK} if isinstance(n, dict) and n.get('fed_token') else n
                               for n in fed['remote_nodes']]
    safe['federation'] = fed
    # 後方互換: edcb_url / amatsukaze_url も返す
    edcb_servers = safe.get('edcb_servers') or []
    amz_servers = safe.get('amatsukaze_servers') or []
    safe['edcb_url'] = (edcb_servers[0] if edcb_servers else {}).get('url', '')
    safe['amatsukaze_url'] = (amz_servers[0] if amz_servers else {}).get('url', '')
    return jsonify(safe)


