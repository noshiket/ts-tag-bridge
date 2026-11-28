"""アドオンの一覧・読み込み（ホットリロード）と、実行中の仕事の置き場。置き場所を探すのは discovery"""

import threading

from .discovery import _addon_entries, _find_entry, _load_module, logger
from .params import _schema_of
from .requirements import requirements_of



_MAX_FINISHED_JOBS = 50  # 完了/失敗ジョブの保持数(超過分は古い順に破棄)

_jobs = {}            # job_id -> job dict
_jobs_lock = threading.Lock()
_busy_videos = set()  # 実行中の video_id(同一videoの同時実行を防ぐ)
# ADDON['queue'] を持つアドオンは、その名前(レーン)ごとに1本ずつ順に流す。
# H.264変換のように CPU/QSV を占有するものを何本も同時に走らせないため
# （音声解析 logic/audio_compare.py の順番待ちと同じ考え方）。
_lane_queues = {}     # レーン名 -> [(job_id, 実処理)]
_lane_active = set()  # 順番待ちを捌くスレッドが動いているレーン


# ---------------------------------------------------------------------------
# 検出・ロード
# ---------------------------------------------------------------------------

def list_addons(target=None, only_enabled=False):
    """アドオン一覧(スキーマ)。ロード失敗はerror付きエントリで返す(UIで原因表示)。

    各エントリに設定画面での有効/無効(enabled)を付ける。only_enabled=True で無効を除く。
    """
    from logic.addons import addon_events  # 循環importを避けるため遅延import  # noqa: F401
    from logic.addons import addon_settings
    out = []
    for name, entry, spdir in _addon_entries():
        try:
            schema = _schema_of(name, _load_module(name, entry, spdir))
            if target and schema['target'] != target:
                continue
            schema['enabled'] = addon_settings.load_settings(
                name, addon_settings.default_enabled(schema['target']))['enabled']
            # 追加依存(requirements.txt)の導入状況。無いアドオンは None
            schema['requirements'] = requirements_of(name)
            # アドオン自身の自己診断。pip 以外の前提(フォント・外部コマンド等)を
            # 設定画面で案内するためのもの。check() が無ければ None。
            schema['health'] = _health_of(name, _load_module(name, entry, spdir))
            out.append(schema)
        except Exception as e:
            # 読み込みに失敗した時こそ requirements を返す。依存ライブラリが無くて
            # import に失敗しているケースを設定画面で案内し、その場で入れられるようにする。
            try:
                reqs = requirements_of(name)
            except Exception:
                reqs = None
            out.append({'name': name, 'target': target or 'video', 'label': name,
                        'description': '', 'params': [], 'steps': ['encode'], 'events': [],
                        'settings_params': [], 'enabled': False, 'error': str(e),
                        'error_type': type(e).__name__, 'requirements': reqs})
    return [a for a in out if a.get('enabled')] if only_enabled else out


# ---------------------------------------------------------------------------
# アドオンの追加依存 (server/addon/<name>/requirements.txt)
# ---------------------------------------------------------------------------

def _health_of(name, mod):
    """アドオンの check() を呼んで {'ok','message','hint'} を返す。無ければ None。

    requirements.txt(pip)で表せない前提 — 日本語フォントや外部コマンドの有無など —
    を設定画面へ出すための口。check() が落ちても一覧は壊さない。
    """
    fn = getattr(mod, 'check', None)
    if not callable(fn):
        return None
    try:
        r = fn() or {}
        return {'ok': bool(r.get('ok')), 'message': str(r.get('message') or ''),
                'hint': str(r.get('hint') or '')}
    except Exception as e:
        logger.debug('アドオン %s の check() が失敗: %s', name, e)
        return {'ok': False, 'message': f'確認できませんでした: {e}', 'hint': ''}


def load_addon(name, target=None):
    """アドオンを新規ロードして (module, schema, sys_path_dir) を返す。

    エンコーダーアドオンのようにジョブ管理を使わず呼び出し側のスレッドで
    同期実行するケース用(エンコードの実行が1本ずつ直列実行するため)。
    見つからない/target不一致/スキーマ不正は ValueError。
    """
    entry, spdir = _find_entry(name)
    if entry is None:
        raise ValueError(f'アドオン {name} が見つかりません')
    mod = _load_module(name, entry, spdir)
    schema = _schema_of(name, mod)
    if target and schema['target'] != target:
        raise ValueError(f'アドオン {name} は target={schema["target"]} です(要 {target})')
    return mod, schema, spdir
