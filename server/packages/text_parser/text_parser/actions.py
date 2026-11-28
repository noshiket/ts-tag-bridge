"""actions — text_parser の ANALYZE アクションをアドオンで増やせるようにする。

アドオンの一覧と読み込みは、使う側が set_addon_source() で渡す（ts-tag-bridge では
server/addon/ の addon_runner）。渡されていなければアドオンのアクションは無いものとする。

server/addon/ に target='parser_action' のアドオンを置くと、
パターン編集画面のアクション一覧に並び、解析時に呼ばれる。

    ADDON = {
        'target': 'parser_action',
        'key':    'concatStr',              # analyze JSON のキー(既存と衝突しないこと)
        'label':  '文字列結合',
        'output_type': 'string',            # UI の表示用
        'default_field': 'title',
        'deferred': True,                   # 出力フィールド({$folder}等)を参照するなら True
        'params': [ ... ],                  # 既存アクションと同じ形式(UIのフォーム定義)
    }

    def run(ctx, config):
        ctx.groups      # {'1': '...', ...} パターンのキャプチャグループ
        ctx.context     # 解析コンテキスト($title/$sid 等)
        ctx.fields      # deferred=True の時だけ: 確定済みの出力フィールド
        ctx.resolve(s)  # {$1}/{$field}/$var をまとめて解決する
        return '文字列'  # 出力フィールドへ入れる値(None なら何も出力しない)

deferred の使い分け:
  False … {$N} と $context だけ使う。setStr と同じタイミングで動く。
  True  … 他の出力フィールド({$title} 等)も使う。全アクションが終わってから動く
          (setPath/addList と同じポスト処理のタイミング)。

branching=True にすると switch と同じ「子アクションを選んで実行する」型になる:
  run() は実行したい子アクションを {'analyze': [...]} で返すだけでよく、
  実行(と入れ子の管理)は text_parser 側が再帰的に行う。
  戻り値が None / analyze 無しなら、そのアクションは何もしない。

fetch_text=True にすると「文字を取ってきて、その文字をパターンで解析する」型になる:
  analyze の書き方は sid / startTimeField / textField / pattern / analyze。
  text_parser が sid・放送日時・照合タイトルを読み替えてから run(ctx, {'sid', 'start_time', 'text'}) を呼び、
  返した文字に pattern / analyze をかける（ほかのアクションが全部済んだ後に動く）。
  None を返すと「見つからない」として parser_error になる。
  アドオンが無効でも、保存済みのパターンを取り違えないよう、このキーは fetch_text のアクションとして扱う
  （その時は見つからないのと同じ扱い）。
"""

import logging
import re
import time

logger = logging.getLogger(__name__)

TARGET = 'parser_action'
# 解析結果に埋めるマーカー。ポスト処理で置き換える。
MARKER = '_addonAction'

# 既存アクションと同じキーは受け付けない(組み込みが優先され混乱するため)
_RESERVED = {
    'setStr', 'setNum', 'setSubtitles', 'addList', 'setPath', 'switch', 'pattern',
    'getEpisodeFromSid', 'getShoboiSubtitle', 'getShoboiEpisode', 'getFromSid',
    'getFromTitleAndEpisode',
}


# アドオンの出どころ。set_addon_source() で渡される
#   list_addons(target=, only_enabled=) -> [スキーマ dict]
#   load_addon(name, target=) -> (モジュール, スキーマ, 置き場)
_list_addons = None
_load_addon = None


def set_addon_source(list_addons, load_addon) -> None:
    """アドオンの一覧と読み込みの関数を渡す。"""
    global _list_addons, _load_addon
    _list_addons, _load_addon = list_addons, load_addon


def list_actions() -> list:
    """アドオンが提供するアクションのスキーマ一覧。読み込み失敗は黙って除く。"""
    out = []
    if _list_addons is None:
        return out
    try:
        schemas = _list_addons(target=TARGET, only_enabled=True)
    except Exception as e:
        logger.debug('parser_action アドオンの一覧取得に失敗: %s', e)
        return out
    for s in schemas:
        # fetch_text のアクションは別の口（fetch_text_key / run_fetch_text / fetch_text_defs）で扱う
        if s.get('error') or s.get('fetch_text'):
            continue
        key = s.get('key') or s.get('name')
        if not key or key in _RESERVED:
            logger.warning('parser_action %s: key=%r は使えません(組み込みと重複)', s.get('name'), key)
            continue
        out.append({
            'key': key,
            'label': s.get('label') or key,
            'description': s.get('description') or '',
            'output_type': s.get('output_type') or 'string',
            'default_field': s.get('default_field') or 'title',
            'deferred': bool(s.get('deferred')),
            'branching': bool(s.get('branching')),
            'addon': s['name'],
            'params': s.get('params') or [],
        })
    return out


# fetch_text のアクションは解析のたびに何度も見分けるので、一覧を短い間だけ覚えておく
# （アドオンの一覧はアドオンを全部読み込み直すので重い）
_FETCH_TEXT_TTL = 30.0
_fetch_text_cache = (float('-inf'), {})


def _fetch_text_actions() -> dict:
    """fetch_text=True のアドオンのアクション。key → {'addon': 名前, 'enabled': bool}。無効なものも含める。"""
    global _fetch_text_cache
    now = time.monotonic()
    if now - _fetch_text_cache[0] < _FETCH_TEXT_TTL:
        return _fetch_text_cache[1]
    out = {}
    if _list_addons is not None:
        try:
            for s in _list_addons(target=TARGET, only_enabled=False):
                if s.get('error') or not s.get('fetch_text'):
                    continue
                key = s.get('key') or s.get('name')
                if key and key not in _RESERVED:
                    out.setdefault(key, {'addon': s['name'], 'enabled': bool(s.get('enabled'))})
        except Exception as e:
            logger.debug('fetch_text アドオンの一覧取得に失敗: %s', e)
    _fetch_text_cache = (now, out)
    return out


def fetch_text_key(config) -> str:
    """analyze の設定が fetch_text のアクションなら、そのキー。違えば None。"""
    if not isinstance(config, dict):
        return None
    acts = _fetch_text_actions()
    return next((k for k in config if k in acts), None)


def run_fetch_text(key: str, sid, start_time: str, text: str):
    """fetch_text のアクションを呼んで文字を返す。見つからない・アドオンが無効なら None。
    アドオンの中の失敗はそのまま投げる（呼び出し側が「見つからない」と同じに扱う）。"""
    a = _fetch_text_actions().get(key)
    if not a or not a['enabled'] or _load_addon is None:
        return None
    mod, _schema, _spdir = _load_addon(a['addon'], target=TARGET)
    return mod.run(ActionContext(), {'sid': sid, 'start_time': start_time, 'text': text})


def fetch_text_defs() -> list:
    """パターン編集画面に出す fetch_text のアクションの定義（無効なものも含める）。
    引数はアドオンが書いたままを渡す（一覧の正規化では引数の説明が落ちるため）。"""
    out = []
    for key, a in _fetch_text_actions().items():
        if _load_addon is None:
            break
        try:
            mod, _schema, _spdir = _load_addon(a['addon'], target=TARGET)
        except Exception as e:
            logger.warning('fetch_text アドオン %s の読み込みに失敗(無視): %s', a['addon'], e)
            continue
        meta = mod.ADDON
        out.append({'key': key, 'label': meta.get('label') or key, 'description': meta.get('description') or '',
                    'output_type': meta.get('output_type') or 'depends_on_nested_analyze',
                    'params': meta.get('params') or [],
                    # 画面はアドオンの名前や鍵を知らず、これで描き分ける（文字を取ってくる型・予行検索ができるか）
                    'addon': a['addon'], 'fetch_text': True,
                    'searchable': callable(getattr(mod, 'search', None))})
    return out


def find(key: str):
    """analyze のキーに対応するアドオンアクションを返す。無ければ None。"""
    if not key or key in _RESERVED:
        return None
    return next((a for a in list_actions() if a['key'] == key), None)


def resolve_text(text, groups=None, fields=None, context=None) -> str:
    """{$N} → キャプチャ、{$name} → 出力フィールド、$name → コンテキスト の順に解決する。

    解決できない参照はそのまま残す(書き間違いを黙って空にしない)。
    """
    if not text or not isinstance(text, str):
        return text or ''

    def braced(m):
        name = m.group(1)
        if name.isdigit():
            return str((groups or {}).get(name, m.group(0)))
        if fields and name in fields:
            v = fields[name]
            if isinstance(v, list):
                v = v[0] if v else ''
            return '' if v is None else str(v)
        if context and name in context:
            return '' if context[name] is None else str(context[name])
        return m.group(0)

    out = re.sub(r'\{\$([a-zA-Z_0-9]\w*)\}', braced, text)

    def bare(m):
        name = m.group(1)
        if context and name in context:
            return '' if context[name] is None else str(context[name])
        return m.group(0)

    return re.sub(r'\$([a-zA-Z_]\w*)', bare, out)


class ActionContext:
    """アドオンの run(ctx, config) に渡すコンテキスト。"""

    def __init__(self, groups=None, context=None, fields=None):
        self.groups = groups or {}
        self.context = context or {}
        self.fields = fields or {}

    def resolve(self, text) -> str:
        return resolve_text(text, self.groups, self.fields, self.context)

    def log(self, msg):
        logger.info('[parser_action] %s', msg)


def run(key: str, config: dict, groups=None, context=None, fields=None):
    """アドオンアクションを実行して値を返す。失敗しても解析全体は止めない。"""
    action = find(key)
    if action is None:
        return None
    try:
        mod, _schema, _spdir = _load_addon(action['addon'], target=TARGET)
        ctx = ActionContext(groups=groups, context=context, fields=fields)
        value = mod.run(ctx, dict(config or {}))
        # 呼んだこと自体を必ず残す。ただし1回の解析で何度も走る(パターン×アクション数)ため、
        # 既定では出さない DEBUG にしておく(必要な時だけログレベルを下げて追う)。
        logger.debug('parser_action %s(%s) → %r', key, action['addon'], value)
        return value
    except Exception as e:
        logger.warning('parser_action %s の実行に失敗(無視): %s', key, e, exc_info=True)
        return None


def make_marker(key: str, config: dict, groups: dict) -> dict:
    """deferred=True のアクション用。出力フィールドが揃ってから実行するための目印。"""
    return {MARKER: key, 'config': dict(config or {}), 'groups': dict(groups or {})}
