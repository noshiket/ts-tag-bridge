"""番組表アドオン（target='guide'）の ctx・取得・正規化とキャッシュ"""

import time
import threading
from datetime import datetime
from .loader import list_addons, load_addon  # noqa: F401
from .discovery import logger  # noqa: F401


# ---------------------------------------------------------------------------
# guide(番組表ソース)
# ---------------------------------------------------------------------------

# 番組表のジャンル。クライアントの配色(_genreStyle)が持っている種別に合わせる。
_GUIDE_GENRES = {'news', 'sport', 'var', 'drama', 'music', 'movie', 'anime', 'doc', 'edu'}

# 取得結果の短期キャッシュ。番組表は帯域タブを行き来する度に取り直しに来るので、
# その都度よそのサービスへ問い合わせに行かないようにする(1日分の編成は頻繁には変わらない)。
_GUIDE_TTL = 600
_guide_cache = {}          # (name, date) -> (取得時刻, データ)
_guide_cache_lock = threading.Lock()


class GuideAddonContext:
    """target='guide' アドオンの実行コンテキスト(EventAddonContext と同じ顔ぶれ)。"""

    def __init__(self, name):
        from logic.addons import addon_events
        from logic.addons import addon_settings  # noqa: F401
        app = addon_events.app_context()
        self.name = name
        self.config = app.get('config') or {}
        self.rule_db = app.get('rule_db')
        self.video_db = app.get('video_db')

    def log(self, msg):
        logger.info('[addon:%s] %s', self.name, msg)


def _guide_start_time(value):
    """開始時刻を EDCB の番組表と同じ 'YYYY-MM-DD HH:MM:SS'(ローカル時刻)へ揃える。

    クライアントは new Date(start_time) でそのまま解釈するため、アドオンが UTC の
    ISO文字列('...Z')を返した場合に時間帯の分だけ番組表がずれる。ここで吸収する。
    """
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value or '').strip().replace('T', ' ')
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def _normalize_guide(raw):
    """guide アドオンの戻り値を番組表が描ける形へ正規化する。

    形の合わない行は落とすだけにする(1件の不備で番組表全体を空にしないため)。
    """
    if not isinstance(raw, dict):
        raise ValueError('guide アドオンは {channels, programs} を返してください')
    channels, ids = [], set()
    for c in (raw.get('channels') or []):
        if not isinstance(c, dict):
            continue
        cid, name = str(c.get('id') or '').strip(), str(c.get('name') or '').strip()
        if not cid or not name or cid in ids:
            continue
        ids.add(cid)
        short = str(c.get('short') or '').strip() or (name[:6] if len(name) > 6 else name)
        # live_url があるチャンネルは「予約録画できる局」として扱われる
        live = str(c.get('live_url') or '').strip()
        channels.append({'id': cid, 'name': name, 'short': short,
                         'logo_url': str(c.get('logo_url') or '') or None,
                         'live_url': live if live.startswith(('http://', 'https://')) else None})
    programs = []
    for p in (raw.get('programs') or []):
        if not isinstance(p, dict):
            continue
        ch = str(p.get('ch') or '').strip()
        start = _guide_start_time(p.get('start_time'))
        if ch not in ids or not start:
            continue
        try:
            dur = int(p.get('duration_sec') or 0)
        except (TypeError, ValueError):
            continue
        if dur <= 0:
            continue
        genre = str(p.get('genre') or '').strip()
        url = str(p.get('url') or '').strip()
        programs.append({
            'ch': ch, 'start_time': start, 'duration_sec': dur,
            'title': str(p.get('title') or '').strip(),
            'description': str(p.get('description') or ''),
            # 詳細（出演者・見どころ等）。番組表のシート表示と、録画時の
            # eit_extended_info / textparser の材料になる
            'extended_info': str(p.get('extended_info') or ''),
            'genre': genre if genre in _GUIDE_GENRES else 'var',
            # 番組を開く先(配信ページ等)。http(s) のみ受ける
            'url': url if url.startswith(('http://', 'https://')) else None,
        })
    return {'channels': channels, 'programs': programs}


def run_scan(recording, ts_path):
    """録画の番組情報を出せるアドオン(provides_scan)に、順に聞く。

    コアは EIT から題名や時刻を取るが、その在り処はソースによって違う。
    放送以外を取り込んだ録画では EIT が無かったり、別の形で持っていたりする。

    ctx.event='recording.scan' で呼ぶ。扱えないアドオンは None を返して降りる
    （自分に関係の無い録画に手を出さないこと）。最初に結果を返したものを採り、
    どのアドオンも降りたらコアが従来どおり EIT を読む。

    戻り値は read_tsprogram.scanner.scan_ts と同じ形の dict、または None。
    アドオンが落ちても録画の登録は続けたいので、例外は握って None にする。
    """
    from logic.addons import addon_events
    from logic.addons import addon_settings
    for schema in list_addons(only_enabled=True):
        if schema.get('error') or not schema.get('provides_scan'):
            continue
        name = schema.get('name')
        try:
            mod, sch, _ = load_addon(name, target=schema.get('target'))
            conf = addon_settings.load_settings(
                name, addon_settings.default_enabled(schema.get('target')))
            params = {p['key']: p.get('default') for p in sch['params']}
            params.update(conf['params'])
            ctx = addon_events.EventAddonContext(
                name, 'recording.scan',
                {'recording': recording, 'ts_path': ts_path,
                 'recording_id': recording.get('id'),
                 'addon': recording.get('addon'), 'sid': recording.get('sid')})
            result = mod.run(ctx, params)
        except Exception as e:
            logger.warning('アドオン %s の番組情報取得に失敗(無視): %s', name, e)
            continue
        if isinstance(result, dict) and result:
            logger.info('アドオン %s が番組情報を出しました', name)
            return result
    return None


def run_guide(name, date=None):
    """target='guide' のアドオンから番組表データを取る。

    date は表示中の日付('YYYY-MM-DD')。params には設定画面(settings_params)の値を
    合わせて渡す(guide には実行毎のフォームが無いため)。
    """
    key = (name, date or '')
    now = time.time()
    with _guide_cache_lock:
        hit = _guide_cache.get(key)
        if hit and now - hit[0] < _GUIDE_TTL:
            return hit[1]
    from logic.addons import addon_events  # noqa: F401
    from logic.addons import addon_settings
    mod, schema, _ = load_addon(name, target='guide')
    conf = addon_settings.load_settings(name, addon_settings.default_enabled('guide'))
    if not conf['enabled']:
        raise ValueError(f'アドオン {name} は無効です(設定→アドオンで有効にしてください)')
    params = {p['key']: p.get('default') for p in schema['settings_params']}
    params.update(conf['params'])
    params['date'] = date
    # 「アドオンが無い/無効」(ValueError)と「取得に失敗した」を呼び出し側が
    # 区別できるよう、実行時の失敗は RuntimeError にまとめる
    try:
        data = _normalize_guide(mod.run(GuideAddonContext(name), params))
    except Exception as e:
        raise RuntimeError(f'アドオン {name} の番組表を取得できませんでした: {e}') from e
    with _guide_cache_lock:
        _guide_cache[key] = (now, data)
        # 日付を跨いで溜まり続けないよう、期限切れはここで落とす
        for k, v in list(_guide_cache.items()):
            if now - v[0] >= _GUIDE_TTL:
                _guide_cache.pop(k, None)
    return data
