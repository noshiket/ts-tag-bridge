"""addon_events — フェーズ通知(イベント)とアドオン設定の保管。

`target='event'` のアドオンに、番組/録画/エンコード/動画の各フェーズを通知する。

    ADDON = {
        'target': 'event',
        'label': 'Discord通知',
        'events': ['recording.added', 'encoding.*'],   # 末尾 '*' でワイルドカード
        'params': [{'key': 'webhook_url', 'label': 'Webhook URL', 'type': 'string'}],
    }

    def run(ctx, params):
        ctx.event    # 'encoding.finished'
        ctx.payload  # イベント毎のdict
        ctx.log('...')

発火するイベント:
  program.added / program.updated       payload: {program_id, program}
  recording.added / recording.updated   payload: {recording_id, recording, changed}
  encoding.queued                       payload: {encoding_id, recording_id, encoding}
  encoding.started                      payload: {encoding_id, state, prev_state, encoding}
  encoding.state                        payload: 同上(全ての状態遷移)
  encoding.finished / encoding.failed   payload: 同上
  video.added                           payload: {video_id, video}
  tick.minute                           payload: {now}  (1分ごと。時刻起動の起点)

呼び出し側(DB層)を絶対に止めないため、配信は専用スレッドで行い例外はログのみに留める。
設定は server/data/addon/<name>.json に置く(手動実行アドオンと違いUIフォームが無いため)。
"""

import queue
import logging
import threading
import time
from datetime import datetime

# 設定（server/data/addon/<name>.json）は addon_settings に。アドオンは addon_events.load_settings で読む
from .addon_settings import load_settings

logger = logging.getLogger(__name__)


# エンコードの state はパイプラインの各段で書き換わる。どれを「開始/完了/失敗」とみなすか。
_STARTED_STATES = {'split_ts', 'encoding'}
_FINISHED_STATES = {'encode_finish', 'encode_end'}
_FAILED_STATES = {'error', 'encode_error'}

_ctx = {}             # {config, rule_db, video_db}
_q = queue.Queue()
_worker = None
_worker_lock = threading.Lock()


# ---------------------------------------------------------------------------
# 発火
# ---------------------------------------------------------------------------

def init(config, rule_db=None, video_db=None):
    """アプリ起動時に一度だけ呼ぶ。呼ばれるまで emit() は何もしない。"""
    _ctx['config'] = config
    _ctx['rule_db'] = rule_db
    _ctx['video_db'] = video_db
    _ensure_ticker()


# ---------------------------------------------------------------------------
# 定期実行(tick)
# ---------------------------------------------------------------------------
# アドオンは呼ばれる度に読み直される(常駐プロセスを持てない)ため、
# 「時刻が来たら動く」類の処理を自前で持てない。その起点だけをここで用意する。
# 購読は他のイベントと同じで、events に 'tick.minute' を書けばよい。
_TICK_INTERVAL = 60
_ticker = None


def _ensure_ticker():
    global _ticker
    with _worker_lock:
        if _ticker is None or not _ticker.is_alive():
            _ticker = threading.Thread(target=_tick_loop, daemon=True, name='AddonTick')
            _ticker.start()


def _tick_loop():
    while True:
        # 起動直後は他の初期化を邪魔しないよう1周期待ってから流す
        time.sleep(_TICK_INTERVAL)
        emit('tick.minute', {'now': datetime.now().strftime('%Y-%m-%d %H:%M:%S')})


def app_context() -> dict:
    """init() で受けたアプリ共有物(config / rule_db / video_db)。

    イベント以外のアドオン(番組表ソース等)も同じ顔ぶれを ctx に載せるための口。
    """
    return dict(_ctx)


def _brief(result, limit: int = 160) -> str:
    """アドオンの戻り値をログ1行に収まる長さへ要約する。"""
    if result is None:
        return '(戻り値なし)'
    text = result if isinstance(result, str) else str(result)
    text = ' '.join(text.split())
    return text if len(text) <= limit else text[:limit] + '…'


def _matches(patterns, event: str) -> bool:
    for p in patterns or []:
        if p == event or p == '*':
            return True
        if p.endswith('*') and event.startswith(p[:-1]):
            return True
    return False


def emit(event: str, payload: dict) -> None:
    """イベントを流す。init() 前・購読者なしなら何もしない。呼び出し側は絶対に落とさない。"""
    if not _ctx:
        return
    try:
        _ensure_worker()
        _q.put_nowait((event, payload or {}))
    except Exception:
        logger.debug('addon_events.emit 失敗(無視): %s', event, exc_info=True)


def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run_loop, daemon=True, name='AddonEvents')
            _worker.start()


def _run_loop():
    while True:
        event, payload = _q.get()
        try:
            _dispatch(event, payload)
        except Exception:
            logger.warning('addon_events: %s の配信で例外(無視)', event, exc_info=True)
        finally:
            _q.task_done()


def _dispatch(event: str, payload: dict):
    from logic.addons import addon_runner
    for schema in addon_runner.list_addons(target='event'):
        if schema.get('error') or not _matches(schema.get('events'), event):
            continue
        conf = load_settings(schema['name'])
        if not conf['enabled']:
            continue
        params = {p['key']: p.get('default') for p in schema['params']}
        params.update(conf['params'])
        # 呼んだこと自体を残す。アドオンが ctx.log() で出す詳細ログとは別で、
        # 「呼ばれたが何もしなかった」(設定で通知OFF等)も追えるようにする。
        # 毎分の tick などで数が多いのでデバッグ扱い（設定の log_debug をオンにすると出る）
        try:
            mod, _schema, _spdir = addon_runner.load_addon(schema['name'], target='event')
            result = mod.run(EventAddonContext(schema['name'], event, payload), params)
            logger.debug('アドオン %s (%s) を実行: %s', schema['name'], event, _brief(result))
        except Exception as e:
            logger.warning('アドオン %s (%s) が失敗: %s', schema['name'], event, e, exc_info=True)


class EventAddonContext:
    """target='event' アドオンの実行コンテキスト。"""

    def __init__(self, name, event, payload):
        self.name = name
        self.event = event
        self.payload = payload
        self.config = _ctx.get('config') or {}
        self.rule_db = _ctx.get('rule_db')
        self.video_db = _ctx.get('video_db')

    def log(self, msg):
        logger.info('[addon:%s] %s', self.name, msg)


# ---------------------------------------------------------------------------
# DB層から呼ぶヘルパー(state遷移の意味づけをここに集約する)
# ---------------------------------------------------------------------------

def emit_encoding_state(enc_id, prev_state, new_state, encoding=None):
    """encodings.state の変化を、開始/完了/失敗に振り分けて流す。"""
    if not new_state or new_state == prev_state:
        return
    base = {'encoding_id': enc_id, 'state': new_state, 'prev_state': prev_state,
            'encoding': encoding}
    emit('encoding.state', base)
    if new_state in _STARTED_STATES and prev_state not in _STARTED_STATES:
        emit('encoding.started', base)
    elif new_state in _FINISHED_STATES:
        emit('encoding.finished', base)
    elif new_state in _FAILED_STATES:
        emit('encoding.failed', base)
