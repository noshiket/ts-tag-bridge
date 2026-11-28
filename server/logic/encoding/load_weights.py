"""急がない解析（CM 解析・音声解析）の重さ。設定画面では「控えめ・ふつう・全力」から選ぶ。

config.yml の cmcut_weight / audio_sync_weight（low / normal / high）で決め、数字の項目
（cmcut_workers・cmcut_nice・cmcut_max_load・audio_sync_nice・audio_sync_max_load）を書いた時はそちらを優先する。
書いていなければ「控えめ」。この機械は録画・エンコード・配信を同時にやり、CPU を取り切ると
熱で落ちることがあったため、急がない解析は譲る側に寄せておく。
"""

import os

WEIGHTS = ('low', 'normal', 'high')
DEFAULT_WEIGHT = 'low'

# nice: 大きいほど譲る / load: この負荷（CPU 数に対する割合）を超えたら並列を落とす・待つ / workers: CPU 数に対する割合
_PRESETS = {
    'low':    {'nice': 19, 'load': 0.5, 'workers': 0.25},
    'normal': {'nice': 10, 'load': 0.8, 'workers': 0.5},
    'high':   {'nice': 0,  'load': 1.0, 'workers': 1.0},
}


def weight_of(config: dict, key: str) -> str:
    w = str(config.get(key) or '').strip()
    return w if w in WEIGHTS else DEFAULT_WEIGHT


def _given(config: dict, key: str):
    """数字の項目が書いてあればその値（空欄・None は書いていない扱い）"""
    v = config.get(key)
    return None if v is None or str(v).strip() == '' else v


def _cpus() -> int:
    return os.cpu_count() or 2


def cmcut_params(config: dict) -> dict:
    """CM 解析の並列数・優先度・並列を落とす負荷"""
    p = _PRESETS[weight_of(config, 'cmcut_weight')]
    workers = _given(config, 'cmcut_workers')
    nice = _given(config, 'cmcut_nice')
    load = _given(config, 'cmcut_max_load')
    return {
        'workers': int(workers) if workers is not None else max(1, int(_cpus() * p['workers'])),
        'nice': int(nice) if nice is not None else p['nice'],
        'max_load': float(load) if load is not None else max(1.0, _cpus() * p['load']),
    }


def audio_sync_params(config: dict) -> dict:
    """音声解析（字幕・弾幕の取り込み、音楽の取り込み、波形）の優先度と待つ負荷"""
    p = _PRESETS[weight_of(config, 'audio_sync_weight')]
    nice = _given(config, 'audio_sync_nice')
    load = _given(config, 'audio_sync_max_load')
    return {
        'nice': int(nice) if nice is not None else p['nice'],
        'max_load': float(load) if load is not None else max(1.0, _cpus() * p['load']),
    }
