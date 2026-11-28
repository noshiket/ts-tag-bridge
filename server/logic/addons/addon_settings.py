"""イベントアドオンの設定（置き場所・既定の有効/無効・読む・書く）"""

import data_paths
import os
import json


_SETTINGS_DIR = os.path.join(data_paths.DATA_DIR, 'addon')


def settings_path(name: str) -> str:
    return os.path.join(_SETTINGS_DIR, f'{os.path.basename(name)}.json')


def default_enabled(target: str) -> bool:
    """未保存アドオンの既定の有効状態。

    通知(event)/設定タブ(settings_tab)は Webhook URL 等を入れて明示的に ON にするものなので
    既定 OFF。番組表ソース(guide)も、よそのサービスへ取りに行くものが黙って番組表のタブに
    並ぶことのないよう既定 OFF。video/encoder は元々 enabled の概念が無く常に使えたので
    既定 ON にして、設定画面から明示的に OFF にできるようにする。
    """
    return target not in ('event', 'settings_tab', 'guide')


def load_settings(name: str, default_on: bool = False) -> dict:
    """{'enabled': bool, 'params': {...}} を返す。未保存なら enabled=default_on の空設定。"""
    try:
        with open(settings_path(name), encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {'enabled': default_on, 'params': {}}
    if not isinstance(d, dict):
        return {'enabled': default_on, 'params': {}}
    params = d.get('params')
    return {'enabled': bool(d.get('enabled', default_on)),
            'params': params if isinstance(params, dict) else {}}


def save_settings(name: str, enabled: bool, params: dict) -> dict:
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    data = {'enabled': bool(enabled), 'params': params if isinstance(params, dict) else {}}
    tmp = settings_path(name) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, settings_path(name))
    return data
