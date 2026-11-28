"""設定の書き換え（変えてよい項目・型・再起動が要る項目・伏せ字の扱い）"""

import asyncio
import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json, _require_admin
from .peers import _auto_seed_new_peers
from .config_keys import _SECRET_MASK, _EDITABLE_SCALAR_KEYS, _INT_KEYS, _BOOL_KEYS, _EDITABLE_COMPLEX_KEYS, _EDITABLE_NESTED_PATHS, _FILE_ONLY_KEYS, _RESTART_KEYS, _RESTART_PREFIXES  # noqa: F401


def _restore_masked_peer_tokens(config: dict, path: str, val):
    """ピア設定に含まれる fed_token がマスクのままなら保存済みの値へ戻す。

    GET /api/config はトークンを '********' にして返し、UI はそれを含めて丸ごと
    送り返してくる。そのまま保存するとマスク文字列がトークンになってしまう。
    remote_nodes は name で、library_peer は単体なのでそのまま突き合わせる。
    """
    fed = config.get('federation') or {}
    if path == 'federation.library_peer':
        if isinstance(val, dict) and val.get('fed_token') == _SECRET_MASK:
            return {**val, 'fed_token': (fed.get('library_peer') or {}).get('fed_token') or ''}
        return val
    if isinstance(val, list):
        prev = {n.get('name'): n for n in (fed.get('remote_nodes') or []) if isinstance(n, dict)}
        return [{**n, 'fed_token': (prev.get(n.get('name')) or {}).get('fed_token') or ''}
                if isinstance(n, dict) and n.get('fed_token') == _SECRET_MASK else n
                for n in val]
    return val


def _set_path(d: dict, path: str, val) -> None:
    """ドットパスでネストされた dict へ値を設定する。val が None ならキーを削除する。"""
    parts = path.split('.')
    cur = d
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    key = parts[-1]
    if val is None:
        cur.pop(key, None)
    else:
        cur[key] = val


@bp.patch('/config')
async def update_config():
    """サーバーの設定を変える（送った項目だけ）。config.yml にも書く。

    再起動が要る項目なら restart_required を返す。データの置き場は、中身を移す前の場所へは変えさせない。管理者だけ。
    """
    _require_admin()
    body = await _json()
    config = current_app.config['ENCODE_AUTO']
    config_path = current_app.config.get('CONFIG_PATH')

    changed = {}       # メモリ+ファイル反映（フラット/複合キー）
    changed_paths = {}  # メモリ+ファイル反映（ドットパスキー）
    file_only = {}     # ファイルのみ反映（jwt_secret）

    # データの置き場は、何かを書き換える前に確かめる（断る時に半端に変わらないように）
    if 'data_dir' in body:
        _check_data_dir(body['data_dir'])

    # スカラー値
    for key in _EDITABLE_SCALAR_KEYS:
        if key not in body:
            continue
        val = body[key]
        if key == 'jwt_secret' and val == _SECRET_MASK:
            continue  # マスクのまま送られてきたら変更なしとみなす
        if key in _INT_KEYS and (val is None or str(val).strip() == ''):
            # 数字の欄を空にした = 書いていない状態へ戻す（既定の値で動く）
            config.pop(key, None)
            changed[key] = None
            continue
        if key in _INT_KEYS:
            val = int(val)
        elif key in _BOOL_KEYS:
            val = val if isinstance(val, bool) else str(val).lower() == 'true'
        if key in _FILE_ONLY_KEYS:
            file_only[key] = val
        else:
            config[key] = val
            changed[key] = val

    # リスト/dict（丸ごと置換）
    for key in _EDITABLE_COMPLEX_KEYS:
        if key in body:
            config[key] = body[key]
            changed[key] = body[key]
    # 作業ディレクトリの候補: 空欄を除き、先頭を tmp_base にも入れる（アップロード等はそちらを使う）
    if 'tmp_base_list' in changed:
        lst = [str(x).strip().rstrip('/') for x in (changed['tmp_base_list'] or []) if str(x).strip()]
        config['tmp_base_list'] = changed['tmp_base_list'] = lst
        if lst:
            config['tmp_base'] = changed['tmp_base'] = lst[0]

    # ドットパス（ネスト部分更新）
    for path, caster in _EDITABLE_NESTED_PATHS.items():
        if path not in body:
            continue
        val = body[path]
        if path.endswith('fed_token') and val == _SECRET_MASK:
            continue
        # library_peer / remote_nodes は dict/list 丸ごと差し替えなので、マスクのまま
        # 保存すると '********' がトークンになってしまう。保存済みの値へ戻す。
        if path in ('federation.library_peer', 'federation.remote_nodes'):
            val = _restore_masked_peer_tokens(config, path, val)
        if val is not None and caster is not None:
            val = caster(val)
        _set_path(config, path, val)
        changed_paths[path] = val

    if not changed and not changed_paths and not file_only:
        abort(400, description='変更可能な項目がありません')

    # ワーカーの interval を即時反映
    workers = current_app.config.get('WORKERS', {})
    if changed.get('phase_a_interval') is not None:
        pa = workers.get('reserve_sync')
        if pa:
            pa.interval = changed['phase_a_interval']
    if changed.get('phase_b_interval') is not None:
        pb = workers.get('recording_watch')
        if pb:
            pb.interval = changed['phase_b_interval']
    if changed.get('phase_b_scan_interval') is not None:
        pbs = workers.get('recording_scan')
        if pbs:
            pbs.interval = changed['phase_b_scan_interval']

    # ログの細かさ・ファイルへの書き込みは、動いているサーバーへそのまま当てる
    if changed.keys() & {'log_debug', 'log_file', 'log_file_path'}:
        from boot.log_settings import apply_log_settings
        apply_log_settings(config)

    # encode_dir_list 変更時はディスクマーカーを再登録（main.py 起動時と同じ処理）
    if 'encode_dir_list' in changed:
        try:
            from logic.storage.disk_guard import register_encode_dirs
            register_encode_dirs(current_app.config['RULE_DB'], config)
        except Exception as e:
            current_app.logger.warning('encode_dir_list のディスク登録に失敗: %s', e)

    # config.yml に書き戻し（コメント保持）
    if config_path:
        from ruamel.yaml import YAML
        _yaml = YAML()
        _yaml.preserve_quotes = True
        with open(config_path, 'r', encoding='utf-8') as f:
            file_data = _yaml.load(f)
        for key, val in changed.items():
            if val is None:
                file_data.pop(key, None)
            else:
                file_data[key] = val
        for path, val in changed_paths.items():
            _set_path(file_data, path, val)
        for key, val in file_only.items():
            _set_path(file_data, key, val)
        with open(config_path, 'w', encoding='utf-8') as f:
            _yaml.dump(file_data, f)

    all_changed = list(changed.keys()) + list(changed_paths.keys()) + list(file_only.keys())
    restart_required = any(
        k in _RESTART_KEYS or any(k.startswith(p) for p in _RESTART_PREFIXES)
        for k in all_changed
    )

    # federationのピア設定(library_peer/remote_nodes)が変わったら、新しく繋がったピアと
    # パターンを自動で揃える(どちらか一方が完全に空の場合のみ。fire-and-forgetで応答は待たない)。
    if any(k in ('federation.library_peer', 'federation.remote_nodes') for k in changed_paths):
        asyncio.create_task(_auto_seed_new_peers(config))

    return jsonify({'success': True, 'changed': all_changed, 'restart_required': restart_required})


def _check_data_dir(value) -> None:
    """データの置き場を変える時、中身を移す前なら断る。空のまま再起動すると、
    録画・ライブラリ・利用者が空の新しい DB で起動してしまう（中身は手で移してから変える）"""
    import data_paths
    target = data_paths.resolve_data_dir(value)
    if target == data_paths.DATA_DIR:
        return
    has_data = os.path.isfile(os.path.join(data_paths.DATA_DIR, 'rules.db'))
    if has_data and not os.path.isfile(os.path.join(target, 'rules.db')):
        abort(400, description=f'{target} にまだデータがありません。サーバーを止めて今の置き場'
                               f'（{data_paths.DATA_DIR}）の中身を移してから変えてください')
