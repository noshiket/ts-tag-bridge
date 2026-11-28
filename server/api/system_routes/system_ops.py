"""接続の確認・鍵の作成・ディスクの空き・サーバーの再起動"""

import data_paths
from boot.ports import listen_port
import asyncio
import os
from quart import jsonify, current_app
from api.routes.auth import bp
from api.routes.caches import _json, _require_admin
from .config_keys import _SECRET_MASK


@bp.post('/config/test_connection')
async def test_connection():
    """設定保存前のフォーム値で EDCB/Amatsukaze/KonomiTV/federation peer への疎通を確認する。"""
    _require_admin()
    body = await _json()
    kind = body.get('type')
    url = (body.get('url') or '').strip()
    if not url:
        return jsonify({'ok': False, 'error': 'url が必要です'})

    def _run():
        if kind == 'edcb':
            from clients.edcb_api.core import EDCBClient
            services = EDCBClient(url).enum_service()
            return f'{len(services)} サービス取得'
        if kind == 'amatsukaze':
            from clients.amatsukaze_api.core import AmatsukazeClient
            sys_info = AmatsukazeClient(url).get_system()
            paused = (sys_info.get('state') or {}).get('pause')
            return f'接続成功（一時停止: {paused}）'
        if kind == 'fed_peer':
            import requests
            fed_token = body.get('fed_token') or ''
            if fed_token == _SECRET_MASK or not fed_token:
                fed_token = (current_app.config['ENCODE_AUTO'].get('federation') or {}).get('fed_token') or ''
            verify_tls = body.get('verify_tls', True)
            resp = requests.get(f'{url.rstrip("/")}/api/fed/ping',
                                headers={'X-Fed-Token': fed_token}, timeout=5, verify=verify_tls)
            if resp.status_code == 401:
                raise RuntimeError('トークン不一致')
            resp.raise_for_status()
            data = resp.json()
            return f'node_id={data.get("node_id", "?")}'
        raise ValueError(f'不明な type: {kind}')

    try:
        # 疎通確認は同期requestsをスレッドへ逃がす。EDCBClient/AmatsukazeClientはリクエスト毎の
        # timeout指定を持たないため、wait_for はタイムアウト検知の保険（スレッド自体は残り得るが
        # 手動テスト用途のため許容する）。
        detail = await asyncio.wait_for(asyncio.to_thread(_run), timeout=8)
        return jsonify({'ok': True, 'detail': detail})
    except asyncio.TimeoutError:
        return jsonify({'ok': False, 'error': 'タイムアウトしました（8秒）'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@bp.post('/config/generate_secret')
async def generate_secret():
    """jwt_secret / federation.fed_token 用の安全なシークレットを生成する。"""
    _require_admin()
    import secrets
    return jsonify({'value': secrets.token_hex(32)})


@bp.post('/config/disk_status')
async def disk_status():
    """encode_dir_list の各パス（未保存の編集中リストも可）のマウント状態・空き容量を返す。"""
    _require_admin()
    body = await _json()
    paths = body.get('paths') or []
    from logic.storage.disk_guard import is_disk_online
    from logic.storage.mount_point import get_mount_points
    import shutil as _shutil
    mounts = get_mount_points(paths) if paths else {}
    result = []
    for p in paths:
        mounted = is_disk_online(p)
        free = total = None
        if mounted and os.path.isdir(p):
            try:
                usage = _shutil.disk_usage(p)
                free, total = usage.free, usage.total
            except OSError:
                pass
        result.append({'path': p, 'mounted': mounted, 'mount_point': mounts.get(p, '/'),
                       'free': free, 'total': total})
    return jsonify(result)


@bp.get('/config/restart/busy')
def restart_busy():
    """再起動の前の確かめ（管理者）。いま動いているエンコードと録画の取り込みの件数。"""
    _require_admin()
    conn = current_app.config['RULE_DB']._get_conn()
    encoding = conn.execute("SELECT COUNT(*) FROM encodings WHERE state = 'encoding'").fetchone()[0]
    scanning = conn.execute("SELECT COUNT(*) FROM recordings WHERE state IN ('scanning', 'pending')").fetchone()[0]
    return jsonify({'encoding': encoding, 'scanning': scanning})


@bp.post('/config/restart')
async def restart_server():
    """GUIから安全にサーバーを再起動する。デタッチした api/system_routes/restart_server.sh が
    このプロセスの終了を確認してから新プロセスを起動するため、DB破損の心配はない。"""
    _require_admin()
    import signal
    import subprocess
    import sys

    config = current_app.config['ENCODE_AUTO']
    config_path = current_app.config.get('CONFIG_PATH')
    port = listen_port(config)
    server_dir = data_paths.SERVER_DIR
    script = os.path.join(server_dir, 'api', 'system_routes', 'restart_server.sh')
    log_path = os.path.join(data_paths.DATA_DIR, 'restart.log')

    with open(log_path, 'a', encoding='utf-8') as log_f:
        subprocess.Popen(
            ['/bin/bash', script, str(os.getpid()), sys.executable, config_path, str(port)],
            cwd=server_dir, start_new_session=True, stdout=log_f, stderr=subprocess.STDOUT,
        )

    # レスポンスを返した後に自プロセスへ SIGTERM（uvicorn の graceful shutdown → after_serving →
    # atexit の Akebi terminate が走る）。restart_server.sh 側は kill -0 でこの PID の消滅を待つ。
    asyncio.get_running_loop().call_later(1.0, os.kill, os.getpid(), signal.SIGTERM)
    return jsonify({'ok': True})
