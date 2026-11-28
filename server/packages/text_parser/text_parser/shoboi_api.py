"""
放送時間とチャンネルから完全な情報を取得する統合プログラム

入力: sid, start_time (または service_name, start_time)
出力: 
  - しょぼいカレンダー情報 (TID, PID, タイトル, 話数)
  - Wikipedia URL
  - Wikipediaリダイレクト先のページ名
"""

import contextlib
import contextvars
import json
import os
import random
import requests
import socket
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup  # noqa: F401
from datetime import datetime, timedelta
import re
from typing import Dict, Optional, List
from . import _config

# 一部のホスト環境ではIPv6経路が「拒否」ではなく「無応答(ブラックホール)」になっており、
# Python の requests/urllib3 は getaddrinfo が返すアドレスを順番に試すだけ(curlのような
# Happy Eyeballs高速フォールバックが無い)ため、IPv6候補1つにつきtimeout秒(約10秒)を
# 丸ごと浪費してからIPv4へフォールバックする。cal.syoboi.jp は複数IPv6候補を返す構成
# (Cloudflare)のため、この環境では1回の外部API呼び出しに30秒前後かかっていた
# (text_parserの再解析が「めちゃくちゃ遅い」不具合の原因)。
# urllib3のアドレスファミリ選択をIPv4限定にし、この無駄な待ちを完全に回避する
# （このモジュールをimportした時点でプロセス全体のrequests/urllib3に適用される。
# 現代の外部サービスはほぼ全てIPv4で到達可能なため実害は無い）。
try:
    import urllib3.util.connection as _urllib3_cn
    _urllib3_cn.allowed_gai_family = lambda: socket.AF_INET
except ImportError:
    pass

# cal.syoboi.jp へのリクエスト間隔制御（syobocal.py と同じサーバーを共有するため）
# 2.0 秒だと解析1件（放送の検索→作品情報→話数の3回）で待ちだけ約6秒かかり、
# 通信そのもの(0.1秒前後)より遥かに長かった。1.0 秒では試験で問い合わせが続いた時に
# 429 を受けたので、間を取って 1.5 秒にした。その後、録画・予約が増えた
# 429（数時間の規制）が続いたため、安全側に倒して 2.0 秒へ戻した。
# 429 が返れば指示された時間止まる。
# 公表値は「1秒に1回・1時間500回・1日10,000回」（https://qiita.com/ani_tick/items/15ac1bec3be7b6cd9e08）。
# 同記事にならい、間隔は公表値の3割以下の 4 秒にする
_syoboi_lock = threading.Lock()
_syoboi_last_time: float = 0.0
_SYOBOI_MIN_INTERVAL = 4.0
# 429 で相手が指示した待ち時間のうち、この秒数までなら待って続ける。これより長い時は
# 待たずに SyobocalRateLimitError で失敗させる。待つと、問い合わせる全員（予約の取り込み・
# 録画の解析）がその間ずっと眠り、録画の取り込みは1本ずつなので後続の録画まで「解析中」の
# まま何時間も止まっていた（実測: 相手の指示が 48241秒・10786秒・3536秒で、
# 録画 6097 が12.5時間、6118 と 6115 が約3時間止まった）。
_SYOBOI_MAX_WAIT = 120

# 規制中に解析を飛ばした印（parser_error に入れる）。規制が明けたら、これの付いた予約・録画を
# 少しずつ解析し直す（workers/reserve_sync, workers/recording_scan）。
# 実際に入れるのは rate_limited_error() の「text_parser:rate_limited(〜10/27 11:05)」の形で、
# いつまで規制かを画面で見られるようにする。見分けるのは is_rate_limited_error() で前半だけ見る
RATE_LIMITED_ERROR = 'text_parser:rate_limited'


def rate_limited_error() -> str:
    """規制で解析を飛ばした印。規制が明ける見込みの時刻を付ける。

    相手の規制(429)ではなく、こちらの1時間の上限で止めた時は「上限」と書いて見分ける。
    """
    from datetime import datetime, timedelta
    with _syoboi_lock:
        real_ban = _syoboi_last_time - time.monotonic()
    if _syoboi_needs_probe and real_ban <= 0:
        return f'{RATE_LIMITED_ERROR}(接続テスト待ち)'
    ban, budget = _limit_waits()
    until = datetime.now() + timedelta(seconds=max(ban, budget))
    label = '' if ban >= budget else '上限 '
    return f'{RATE_LIMITED_ERROR}({label}〜{until:%m/%d %H:%M})'


def is_rate_limited_error(e) -> bool:
    return isinstance(e, str) and e.startswith(RATE_LIMITED_ERROR)


def has_rate_limited_error(errors) -> bool:
    """parser_error（リストまたは JSON 文字列）に規制で飛ばした印があるか。"""
    if isinstance(errors, str):
        return RATE_LIMITED_ERROR in errors
    return any(is_rate_limited_error(e) for e in (errors or []))


# ── 規制を延ばさないための自制 ─────────────────────────────────────────
# 規制(429)は1時間単位の枠らしく、明けた直後にまとめて問い合わせると数分で次の枠まで延びた
# （実測、片方のサーバー: 19:00 に明けて 19:03 に再び 429、20:00 に明けて 20:02 に再び 429）。
# また規制中かどうかの記憶がメモリだけで、再起動のたびに1回問い合わせて規制を延ばしていた。
#   - 規制の期限をファイルに残し、再起動しても期限までは1回も問い合わせない
#   - 期限が来ても _SYOBOI_RESUME_MARGIN 秒は再開しない
#   - 1時間あたりの問い合わせを _SYOBOI_HOURLY_BUDGET 回までにする（超えたら規制中と同じ扱いで、
#     送らずに SyobocalRateLimitError。呼び出し側は解析を後回しにする）
#   - 後回しにできる処理（日次の再解析・規制明けの溜まり分・予約の番組情報更新）は background()
#     の中で動かし、そのうち _SYOBOI_BACKGROUND_BUDGET 回までしか使わせない。残りは録画の解析と
#     画面からの操作に取っておく（実測: 日次の再解析が2分で60回を使い切り、
#     その後1時間、録画の解析も画面からの再解析も断られた）
# 置き場所は TEXT_PARSER_DATA_DIR の下（_config）。TSTAG_SHOBOI_STATE でファイルだけ変えられる
_SYOBOI_RESUME_MARGIN = 600
# 公表値(1時間500回・1日10,000回)よりずっと少ない回数で規制されていた。ブラウザを装った
# User-Agent と HTML の読み取り(bot 利用規約違反)が原因かもしれないので、それを直した後も
# しばらくは控えめにし、規制されなくなったら公表値の3割を目安に上げる。
# 1時間120回にしたところ、2日止めて再開した後の約2時間・
# 140回目で約23時間の規制を受けた（直近1時間は10回だけ）。1時間より
# 長い期間の合計で数えているらしいので、1時間に加えて1日（11:00 区切り、規制の期限が
# 11:00 ちょうどのことが多かったため）の上限も置く。上限は1台ごと。
# 規約に合わせて再開した後、1日100回（1時間あたり最大26回）で丸1日規制されなかった
# ので、1日120回に上げた。
_SYOBOI_HOURLY_BUDGET = 30
_SYOBOI_BACKGROUND_BUDGET = 20
_SYOBOI_DAILY_BUDGET = 120
_SYOBOI_DAILY_BACKGROUND_BUDGET = 100     # 残り20回は録画の解析と画面からの再解析に取っておく
_SYOBOI_DAY_START_HOUR = 11
_background = contextvars.ContextVar('syoboi_background', default=False)


@contextlib.contextmanager
def background():
    """この中の問い合わせは、1時間の上限のうち _SYOBOI_BACKGROUND_BUDGET 回までに抑える。

    デコレータとしても使える（@background()）。別スレッドへ引き継ぐには
    contextvars.copy_context() で包む（add_recording._parse_with_timeout）。
    """
    token = _background.set(True)
    try:
        yield
    finally:
        _background.reset(token)
_SYOBOI_STATE_PATH = os.environ.get('TSTAG_SHOBOI_STATE') or os.path.join(
    _config.data_dir(), 'shoboi_rate_limit.json')
# 送った時刻(time.time())。上限の判定は直近1時間だけを見るが、日単位の枠もあるらしいので
# （どちらのサーバーも規制の期限がちょうど 11:00:00 だった）1日ぶん残し、
# 429 の時に「11:00 から何回送ったか」をログに出す
_SYOBOI_SENT_KEEP = 25 * 3600
_syoboi_sent: list = []
_syoboi_ban_until = 0.0          # 規制が明ける時刻(time.time())。ファイルにも残す
# 429 の Retry-After は「次の正時まで」しか言わず、従って再開してもすぐ 429 になり、そのたびに
# 規制が延びた（片方のサーバーは正時の10分後に再開して数分・7〜24回で 429 を8回、
# 別のサーバーは1時間に1回しか送っていないのに 429 を3回、3回目で翌日の正時まで）。
#   - 24時間以内に続けて 429 を受けたら、2回目から待ちを 2, 4, 8, …時間（最大24時間）と倍にする
#   - 規制明けから _SYOBOI_PROBATION 秒は1時間 _SYOBOI_PROBATION_BUDGET 回までに絞る
_SYOBOI_STRIKE_RESET = 86400
_SYOBOI_MAX_BACKOFF = 86400
_SYOBOI_PROBATION = 3600
_SYOBOI_PROBATION_BUDGET = 10
_syoboi_strikes = 0              # 続けて受けた 429 の回数
_syoboi_last_429 = 0.0           # 最後に 429 を受けた時刻(time.time())
# 429 を受けたら、期限が来ても自動では再開しない。probe()（接続テスト）で1回だけ問い合わせて
# 通るのを確かめてから再開する（規制明けにそのまま再開してはすぐ規制され、規制が延び続けたため。
# bot 利用規約の「失敗が続く場合は自動取得を停止」にも当たる）
_syoboi_needs_probe = False
_probing = contextvars.ContextVar('syoboi_probing', default=False)
# しょぼいカレンダーへの問い合わせは同時に1本だけ（bot 利用規約: 並列リクエストの禁止）。
# 送ってから応答を受け取るまでこれを持つ。間隔は応答を受け取った時刻から測る
_syoboi_req_lock = threading.Lock()


def _save_state_locked() -> None:
    try:
        os.makedirs(os.path.dirname(_SYOBOI_STATE_PATH), exist_ok=True)
        tmp = _SYOBOI_STATE_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'ban_until': _syoboi_ban_until, 'sent': _syoboi_sent,
                       'strikes': _syoboi_strikes, 'last_429': _syoboi_last_429,
                       'needs_probe': _syoboi_needs_probe}, f)
        os.replace(tmp, _SYOBOI_STATE_PATH)
    except OSError as e:
        print(f"[syoboi] 規制の状態を保存できません: {e}", flush=True)


def _load_state() -> None:
    """起動時に、前回までの規制の期限と直近1時間の問い合わせを読み戻す。"""
    global _syoboi_last_time, _syoboi_ban_until, _syoboi_sent, _syoboi_strikes, _syoboi_last_429
    global _syoboi_needs_probe
    try:
        with open(_SYOBOI_STATE_PATH, encoding='utf-8') as f:
            st = json.load(f)
    except (OSError, ValueError):
        return
    now = time.time()
    _syoboi_sent = [t for t in (st.get('sent') or []) if isinstance(t, (int, float)) and now - t < _SYOBOI_SENT_KEEP]
    _syoboi_strikes = int(st.get('strikes') or 0)
    _syoboi_last_429 = float(st.get('last_429') or 0)
    until = float(st.get('ban_until') or 0)
    _syoboi_ban_until = until            # 明けた後も、絞る期間の判定に使う
    # この仕組みより前の記録は、規制を受けたことがあれば接続テスト待ちにする
    _syoboi_needs_probe = bool(st.get('needs_probe', until > 0))
    if until > now:
        _syoboi_last_time = time.monotonic() + (until - now)
        print(f"[syoboi] 前回からの規制が続いています。{time.strftime('%m/%d %H:%M', time.localtime(until))} "
              f"まで問い合わせません", flush=True)
    if _syoboi_needs_probe:
        print("[syoboi] 接続テスト(probe)で通るのを確かめるまで、しょぼいカレンダーへは問い合わせません", flush=True)


def _budget_wait_locked() -> float:
    """上限に達していれば、枠が空くまでの秒数。達していなければ 0。"""
    return _budget_state_locked()[0]


def _day_start(now: float) -> float:
    """1日の上限の区切り（直近の 11:00 + 日ごとに決まる 10〜20分）。

    区切りの 11:00 ちょうどに一斉に再開しないよう、日ごとにずらす（Qiita の記事の方針）。
    """
    def start_of(d):
        return d.timestamp() + random.Random(int(d.timestamp())).uniform(600, 1200)
    d = datetime.fromtimestamp(now).replace(hour=_SYOBOI_DAY_START_HOUR, minute=0, second=0, microsecond=0)
    if start_of(d) > now:
        d -= timedelta(days=1)
    return start_of(d)


def _budget_state_locked() -> tuple:
    """(枠が空くまでの秒数, どの上限か)。1日の上限と1時間の上限のうち長く待つ方。"""
    now = time.time()
    day_budget = _SYOBOI_DAILY_BACKGROUND_BUDGET if _background.get() else _SYOBOI_DAILY_BUDGET
    start = _day_start(now)
    if sum(1 for t in _syoboi_sent if t >= start) >= day_budget:
        # 次の区切り（翌日の 11:00 + 10〜20分）まで待つ
        return max(0.0, _day_start(start + 86400 + 1200) - now), f'1日{day_budget}回'
    wait = _hour_wait_locked()
    budget = _SYOBOI_BACKGROUND_BUDGET if _background.get() else _SYOBOI_HOURLY_BUDGET
    return wait, (f'1時間{budget}回' if wait > 0 else '')


def _hour_wait_locked() -> float:
    now = time.time()
    _syoboi_sent[:] = [t for t in _syoboi_sent if now - t < _SYOBOI_SENT_KEEP]
    hour = [t for t in _syoboi_sent if now - t < 3600]
    budget = _SYOBOI_BACKGROUND_BUDGET if _background.get() else _SYOBOI_HOURLY_BUDGET
    if 0 < now - _syoboi_ban_until < _SYOBOI_PROBATION:
        # 規制明けの直後は少しずつ。回数は明けた後に送った分だけ数える
        hour = [t for t in hour if t >= _syoboi_ban_until]
        budget = min(budget, _SYOBOI_PROBATION_BUDGET)
        if len(hour) >= budget:
            return max(0.0, _syoboi_ban_until + _SYOBOI_PROBATION - now)
        return 0.0
    if len(hour) < budget:
        return 0.0
    # 古い方から (len - budget + 1) 件が1時間を過ぎれば1回ぶん空く
    return max(0.0, hour[len(hour) - budget] + 3600 - now)


def _record_sent_locked() -> None:
    _syoboi_sent.append(time.time())
    _save_state_locked()


def _record_ban_locked(retry_after: float) -> None:
    """429 を受けた。期限に余裕を足して覚え、ファイルにも残す。

    24時間以内に続けて受けた時は、2回目から Retry-After より長く 2, 4, 8, …時間（最大24時間）待つ。
    """
    global _syoboi_last_time, _syoboi_ban_until, _syoboi_strikes, _syoboi_last_429, _syoboi_needs_probe
    now = time.time()
    _syoboi_needs_probe = True
    _syoboi_strikes = _syoboi_strikes + 1 if now - _syoboi_last_429 < _SYOBOI_STRIKE_RESET else 1
    _syoboi_last_429 = now
    backoff = 0 if _syoboi_strikes <= 1 else min(_SYOBOI_MAX_BACKOFF, 3600 * 2 ** (_syoboi_strikes - 1))
    # bot 利用規約: 待ちは段階的に延ばし、乱数を足して再開が集中しないようにする
    wait = max(retry_after, backoff) + _SYOBOI_RESUME_MARGIN * (1 + random.random())
    _syoboi_last_time = time.monotonic() + wait
    _syoboi_ban_until = time.time() + wait
    _save_state_locked()


def rate_limit_remaining() -> float:
    """しょぼいカレンダーへ問い合わせられるようになるまでの秒数。今すぐ問い合わせられれば 0。

    規制(429)の残りと、1時間の上限に達した時の枠が空くまでのうち長い方。
    呼び出し側はこれを見て解析を後回しにする（規制中に問い合わせると規制が延びる）。
    """
    return max(_limit_waits())


def _limit_waits() -> tuple:
    """(規制(429)の残り秒数, 上限で枠が空くまでの秒数)。

    接続テスト待ちの間は、規制の期限が過ぎても「規制中」(1時間)として答える。
    """
    with _syoboi_lock:
        ban = max(0.0, _syoboi_last_time - time.monotonic())
        if _syoboi_needs_probe and not _probing.get():
            ban = max(ban, 3600.0)
        return ban, _budget_wait_locked()


# ── 作品情報の記憶 ─────────────────────────────────────────
#
# 解析のたびに、しょぼいカレンダーへ 3 回ほど問い合わせ、最低間隔の待ちで数秒かかっていた。
# そのうち作品単位で変わりにくいものだけを覚えて使い回す。
#
#   覚える   : TitleLookup（作品名・略称・読み）、しょぼいカレンダーの作品ページ(/tid/<TID>)、
#              Wikipedia のページ（wiki_title）
#   毎回取る : ProgLookup（話数・サブタイトル・放送異常告知）。放送の前後に登録・修正される
#
#   - 覚えるのは解析が parser_error なしで終わった時だけ。失敗した解析で使った記憶は捨てる。
#   - 取り直す(fresh)指定の間は覚えた分を使わず取り直し、記憶を新しい内容に替える
#     （再解析ボタン。略称や作品名が向こうで直った時に拾うため）。
#     全サブタイトルの一覧も TitleLookup に入っているが、話数が増えるので常に取り直す。
#   - 最後に使ってから PARSE_CACHE_KEEP_DAYS 日使われなかったものは消す（放送日は見ない。
#     古い TS を解析し直すこともあるため）。掃除は解析の終わりに、1時間に1回まで行う。
#   - 解析の外からの問い合わせは覚えず、覚えた分も使わない。
PARSE_CACHE_PATH = os.path.join(_config.data_dir(), 'shoboi_cache.db')
PARSE_CACHE_KEEP_DAYS = 30
_PARSE_CACHE_PRUNE_INTERVAL = 3600.0
_parse_cache_lock = threading.Lock()
_parse_local = threading.local()
_parse_cache_last_prune = 0.0
_WORK_PAGE_RE = re.compile(r'^https?://cal\.syoboi\.jp/tid/\d+/?$')


_expires_col_ok = False


def _cache_expiry(cache_control) -> tuple:
    """応答の Cache-Control から (覚えてよいか, 期限 time.time() か None)。

    しょぼいカレンダーの bot 利用規約: レスポンスの Cache-Control に従う。
    no-store / no-cache / private は覚えない。max-age があればその秒数で期限を切る。
    指定が無ければ期限なし（PARSE_CACHE_KEEP_DAYS 日使われなければ消える従来どおり）。
    """
    cc = (cache_control or '').lower()
    if any(d in cc for d in ('no-store', 'no-cache', 'private')):
        return False, None
    m = re.search(r'(?:s-maxage|max-age)\s*=\s*(\d+)', cc)
    if m:
        n = int(m.group(1))
        return n > 0, time.time() + n
    return True, None


def _parse_cache_conn():
    os.makedirs(os.path.dirname(PARSE_CACHE_PATH), exist_ok=True)
    conn = sqlite3.connect(PARSE_CACHE_PATH, timeout=10)
    conn.execute("CREATE TABLE IF NOT EXISTS work_responses ("
                 "key TEXT PRIMARY KEY, url TEXT, encoding TEXT, body BLOB, used_at REAL, expires REAL)")
    global _expires_col_ok
    if not _expires_col_ok:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(work_responses)")]
        if 'expires' not in cols:
            conn.execute("ALTER TABLE work_responses ADD COLUMN expires REAL")
        _expires_col_ok = True
    conn.execute("CREATE TABLE IF NOT EXISTS title_tid (keyword TEXT PRIMARY KEY, info TEXT, at REAL)")
    return conn


# getFromTitleAndEpisode で作品名を検索した候補(TID・作品名・略称・読み・一致の度合い・最初の話数)を
# 覚える。次からは作品名の検索(TitleLookup の曖昧検索)を飛ばし、選んだ TID の副題を引く1回だけにする。
# 作品は変わらないので期限は付けない。fresh()（画面からの再解析）では使わず、決め直して覚え直す
def remembered_title(keyword: str) -> Optional[dict]:
    if not keyword or getattr(_parse_local, 'fresh', False):
        return None
    try:
        with _parse_cache_lock:
            conn = _parse_cache_conn()
            try:
                row = conn.execute("SELECT info, at FROM title_tid WHERE keyword = ?", (keyword,)).fetchone()
            finally:
                conn.close()
        if not row:
            return None
        info = json.loads(row[0])
        info['searched_at'] = row[1]       # 最後に作品名で検索した時刻
        return info
    except Exception:
        return None


def remember_title(keyword: str, info: dict, searched_at: float = None) -> None:
    """searched_at は作品名で検索した時刻（候補に最初の話数を書き足すだけの時は前の時刻のまま）。"""
    try:
        with _parse_cache_lock:
            conn = _parse_cache_conn()
            try:
                conn.execute("INSERT OR REPLACE INTO title_tid (keyword, info, at) VALUES (?, ?, ?)",
                             (keyword, json.dumps(info, ensure_ascii=False),
                              searched_at if searched_at is not None else time.time()))
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        print(f"[shoboi cache] 作品の記録に失敗: {e}", flush=True)


def _cacheable(url, kwargs) -> bool:
    """作品単位で変わりにくい問い合わせか。"""
    url = str(url)
    params = kwargs.get('params') or {}
    if 'cal.syoboi.jp/db.php' in url:
        return isinstance(params, dict) and params.get('Command') == 'TitleLookup'
    return bool(_WORK_PAGE_RE.match(url)) or 'wikipedia.org/' in url


def _request_key(url, kwargs) -> str:
    params = kwargs.get('params')
    if isinstance(params, dict):
        params = sorted((str(k), str(v)) for k, v in params.items())
    return json.dumps([str(url), params], ensure_ascii=False, default=str)


@contextlib.contextmanager
def fresh():
    """この中の問い合わせは覚えた分を使わず取り直す（取り直した内容は覚え直す）。"""
    prev = getattr(_parse_local, 'fresh', False)
    _parse_local.fresh = True
    try:
        yield
    finally:
        _parse_local.fresh = prev


def begin_parse_capture() -> None:
    """解析の開始。この後の問い合わせで覚えた分を使い、新しく取った分は集める。"""
    stack = getattr(_parse_local, 'stack', None)
    if stack is None:
        stack = _parse_local.stack = []
    stack.append({'captured': [], 'used': []})


def in_parse_capture() -> bool:
    """解析の途中か（入れ子の呼び出しで二重に始めないため）。"""
    return bool(getattr(_parse_local, 'stack', None))


def end_parse_capture(ok: bool) -> None:
    """解析の終了。ok(parser_error なし)なら新しく取った分を覚え、失敗なら使った記憶も捨てる。"""
    stack = getattr(_parse_local, 'stack', None)
    if not stack:
        return
    frame = stack.pop()
    if not frame['captured'] and not frame['used']:
        return
    try:
        now = time.time()
        with _parse_cache_lock:
            conn = _parse_cache_conn()
            try:
                if ok:
                    for key, url, encoding, body, cc in frame['captured']:
                        keep, expires = _cache_expiry(cc)
                        if not keep:
                            continue
                        conn.execute("INSERT OR REPLACE INTO work_responses "
                                     "(key, url, encoding, body, used_at, expires) VALUES (?,?,?,?,?,?)",
                                     (key, url, encoding, body, now, expires))
                    for key in frame['used']:
                        conn.execute("UPDATE work_responses SET used_at = ? WHERE key = ?", (now, key))
                else:
                    for key in frame['used'] + [c[0] for c in frame['captured']]:
                        conn.execute("DELETE FROM work_responses WHERE key = ?", (key,))
                conn.commit()
            finally:
                conn.close()
        _prune_parse_cache_if_due()
    except Exception as e:
        # 記憶は速くするためだけのもの。失敗しても解析は続ける
        print(f"[shoboi cache] 保存に失敗: {e}", flush=True)


def _parse_frame():
    stack = getattr(_parse_local, 'stack', None)
    return stack[-1] if stack else None


def _cached_response(key):
    """覚えた応答と、相手の Cache-Control で「まだ新しい」と言われている間か (resp, bool)。

    Cache-Control の期限を過ぎた分は使わない（None）。
    """
    try:
        with _parse_cache_lock:
            conn = _parse_cache_conn()
            try:
                row = conn.execute("SELECT url, encoding, body, expires FROM work_responses WHERE key = ?",
                                   (key,)).fetchone()
            finally:
                conn.close()
    except Exception:
        return None, False
    if not row:
        return None, False
    if row[3] is not None and time.time() > row[3]:
        return None, False
    resp = requests.Response()
    resp.status_code = 200
    resp.url, resp.encoding, resp._content = row[0], row[1], row[2]
    return resp, row[3] is not None


def prune_parse_cache(now: float = None) -> int:
    """最後に使ってから PARSE_CACHE_KEEP_DAYS 日使われなかった記憶を消す。消した件数を返す。"""
    cutoff = (now if now is not None else time.time()) - PARSE_CACHE_KEEP_DAYS * 86400
    with _parse_cache_lock:
        conn = _parse_cache_conn()
        try:
            n = conn.execute("DELETE FROM work_responses WHERE used_at < ?", (cutoff,)).rowcount
            conn.commit()
            return n
        finally:
            conn.close()


def _prune_parse_cache_if_due() -> None:
    global _parse_cache_last_prune
    now = time.monotonic()
    if now - _parse_cache_last_prune < _PARSE_CACHE_PRUNE_INTERVAL:
        return
    _parse_cache_last_prune = now
    n = prune_parse_cache()
    if n:
        print(f"[shoboi cache] {PARSE_CACHE_KEEP_DAYS}日使われていない {n}件の記憶を消しました", flush=True)


# 一時的な通信失敗の再試行。実測で「1〜2回失敗して3回目に成功」が多い。
# 再試行するのは「繋がらなかった」時だけで、HTTP の応答が返っていれば内容に関わらず
# そのまま返す（混んでいる相手を叩き直して締め出されないため）。再試行の前にも
# _SYOBOI_MIN_INTERVAL を空ける。
_HTTP_ATTEMPTS = 3
_HTTP_BACKOFF = 0.8


# しょぼいカレンダーの bot 利用規約(https://docs.cal.syoboi.jp/rule/bot/)は、アプリ名・版・連絡先を
# 入れた独自の User-Agent を求める。以前はブラウザを装っていた。連絡先は config.yml の
# shoboi_contact（URL かメールアドレス）で、起動時に set_contact() で渡す。空なら、このアプリの
# 案内のページ（公開しているリポジトリ）を入れる（連絡先の無い User-Agent で問い合わせないため）
_APP_UA = 'ts-tag-bridge/1.0'
_DEFAULT_CONTACT = 'https://github.com/noshiket/ts-tag-bridge'
_contact = ''


def set_contact(contact: str) -> None:
    global _contact
    _contact = (contact or '').strip()


def user_agent() -> str:
    return f'{_APP_UA} (+{_contact or _DEFAULT_CONTACT})'


# 規制・上限で問い合わせられなかった回数。解析の前後で比べ、しょぼいカレンダーを使わない
# 解析は規制中でもそのまま使えるようにする（hit_limit_during）
_limited_count = 0


def limited_count() -> int:
    return _limited_count


def limit_handled() -> None:
    """断られた問い合わせを、手元の番組表など別の方法で補えた（後回しにしなくてよい）。"""
    global _limited_count
    _limited_count -= 1


def hit_limit_during(before: int, errors) -> bool:
    """解析の結果が規制のせいで欠けたか。

    before は解析の前の limited_count()。取れなかった項目に規制の印があるか、エラーが残っていて
    解析の間に規制で断られていれば（印を付けずに握りつぶす経路もあるため）欠けたとみなす。
    """
    errors = list(errors or [])
    if any('__rate_limited__' in str(e) for e in errors):
        return True
    return bool(errors) and _limited_count != before


class SyobocalRateLimitError(Exception):
    """cal.syoboi.jp が 429 を返したときに送出される例外"""
    def __init__(self, retry_after: int = 60, budget: int = 0, label: str = ''):
        global _limited_count
        _limited_count += 1
        self.retry_after = retry_after
        if budget:
            # 相手の規制ではなく、こちらの1時間の上限で送らなかった
            super().__init__(
                f"しょぼいカレンダーへの問い合わせ上限（{label or f'1時間{budget}回'}）に達したため、"
                f"約{retry_after}秒待ちます"
            )
            return
        super().__init__(
            f"しょぼいカレンダーがレート制限中です。約{retry_after}秒後に再試行してください"
        )


def probe() -> dict:
    """接続テスト。しょぼいカレンダーへ1回だけ問い合わせ、通れば止めていた問い合わせを再開する。

    規制(429)の期限前は送らない（送ると規制が延びる）。問い合わせるのは作品1件の TitleLookup。
    戻り値: 送ったか、通ったか、HTTP の状態、Retry-After、Cache-Control、送った User-Agent など。
    """
    global _syoboi_needs_probe, _syoboi_ban_until
    with _syoboi_lock:
        remaining = max(0.0, _syoboi_last_time - time.monotonic())
        until = _syoboi_ban_until
    if remaining > 0:
        return {'sent': False, 'ok': False,
                'reason': f"規制期間中です（{time.strftime('%m/%d %H:%M', time.localtime(until))} まで）"}
    finder = CompleteProgramFinder()
    out = {'sent': True, 'ok': False, 'user_agent': finder.session.headers.get('User-Agent')}
    token = _probing.set(True)
    try:
        resp = finder.session.get(f'{finder.BASE_URL}/db.php',
                                  params={'Command': 'TitleLookup', 'TID': '1'}, timeout=10)
    except SyobocalRateLimitError as e:
        out.update(status=429, retry_after=e.retry_after, reason=str(e))
        return out
    except requests.RequestException as e:
        out.update(reason=f'通信に失敗: {e}')
        return out
    finally:
        _probing.reset(token)
    out.update(status=resp.status_code, cache_control=resp.headers.get('Cache-Control'),
               retry_after=resp.headers.get('Retry-After'))
    try:
        item = ET.fromstring(resp.content).find('.//TitleItem')
    except ET.ParseError:
        item = None
    out['title'] = item.findtext('Title', '') if item is not None else None
    out['ok'] = resp.status_code == 200 and item is not None
    if out['ok']:
        with _syoboi_lock:
            _syoboi_needs_probe = False
            _syoboi_ban_until = time.time()      # ここから1時間は少しずつ（_SYOBOI_PROBATION）
            _save_state_locked()
        print("[syoboi] 接続テストが通りました。しょぼいカレンダーへの問い合わせを再開します", flush=True)
    else:
        print(f"[syoboi] 接続テストが通りませんでした: {out}", flush=True)
    return out


def probe_status() -> dict:
    """接続テスト待ちか・規制の期限・直近の送信回数（画面・API 用）。"""
    with _syoboi_lock:
        now = time.time()
        remaining = max(0.0, _syoboi_last_time - time.monotonic())
        return {'needs_probe': _syoboi_needs_probe, 'ban_remaining': int(remaining),
                'ban_until': _syoboi_ban_until if remaining > 0 else None,
                'sent_1h': sum(1 for t in _syoboi_sent if now - t < 3600),
                'sent_today': sum(1 for t in _syoboi_sent if t >= _day_start(now)),
                'strikes': _syoboi_strikes, 'user_agent': user_agent()}


def format_episode_string(count, subtitle: str = "") -> str:
    """話数とサブタイトルからエピソード文字列を生成"""
    if count is None:
        return subtitle or ""
    try:
        episode_num = f"#{int(count):02d}"
    except (ValueError, TypeError):
        episode_num = f"#{count}"
    return f"{episode_num} {subtitle}".strip() if subtitle else episode_num


# しょぼいカレンダーのサブタイトルをプロセス内で共有するキャッシュ。
#
# text_parser は解析のたびに CompleteProgramFinder() を作り直すので、インスタンス側の
# キャッシュだけでは毎回 API を叩くことになる。同じ録画を解析し直すたびに結果が変わる
# （通信が失敗した回だけサブタイトルが空になる）のはこれが原因。
#
# 放送中の作品は話数が増えるので、永続化はせず短めの TTL で持つ。取得に失敗した時は
# 覚えない（空を焼き付けない）。
_SHARED_SUBTITLES: dict = {}
_SHARED_SUBTITLES_TTL = 3600.0
_SHARED_SUBTITLES_LOCK = threading.Lock()


def _shared_subtitles_get(tid):
    with _SHARED_SUBTITLES_LOCK:
        hit = _SHARED_SUBTITLES.get(str(tid))
    if not hit:
        return None
    ts, episodes = hit
    if time.time() - ts > _SHARED_SUBTITLES_TTL:
        return None
    return list(episodes)


def _shared_subtitles_put(tid, episodes):
    with _SHARED_SUBTITLES_LOCK:
        _SHARED_SUBTITLES[str(tid)] = (time.time(), list(episodes))


# メソッドの多くは機能ごとのファイルにある（shoboi_titles / shoboi_programs / shoboi_info）。
# それらは shoboi_api を使う時に引くので、ここでの読み込みは循環しない
from .shoboi_channels import CHANNEL_NAME_TO_CHID as _CHANNEL_NAME_TO_CHID, SID_TO_CHID as _SID_TO_CHID  # noqa: E402
from .shoboi_info import _InfoMixin  # noqa: E402
from .shoboi_programs import _ProgramsMixin  # noqa: E402
from .shoboi_titles import _TitlesMixin  # noqa: E402


class CompleteProgramFinder(_TitlesMixin, _ProgramsMixin, _InfoMixin):
    """放送時間とチャンネルから完全な番組情報を取得"""
    
    BASE_URL = "http://cal.syoboi.jp"
    SID_TO_CHID = _SID_TO_CHID
    CHANNEL_NAME_TO_CHID = _CHANNEL_NAME_TO_CHID
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': user_agent()})
        # TitleLookup(tid毎)の結果をラン内メモ化してAPIアクセスを削減する。
        # 作品情報/全サブタイトルは短時間で変化しないため使い回して安全。
        self._title_info_cache: Dict[str, Optional[Dict]] = {}
        self._subtitles_cache: Dict[str, List[Dict]] = {}

        # cal.syoboi.jp 宛のリクエストにのみレート制限を適用し、429 を SyobocalRateLimitError に変換
        _orig_get = self.session.get
        def _wait_turn(is_syoboi):
            """しょぼいカレンダー宛は最低間隔を空ける。再試行の前にも必ず通す。"""
            global _syoboi_last_time
            if not is_syoboi:
                return
            if _syoboi_needs_probe and not _probing.get():
                raise SyobocalRateLimitError(3600)
            with _syoboi_lock:
                elapsed = time.monotonic() - _syoboi_last_time
                wait = _SYOBOI_MIN_INTERVAL - elapsed
                budget_wait, label = _budget_state_locked()
            if budget_wait > 0:
                # 上限に達した。送らずに、規制中と同じく失敗させる
                raise SyobocalRateLimitError(
                    int(budget_wait) + 1,
                    budget=_SYOBOI_BACKGROUND_BUDGET if _background.get() else _SYOBOI_HOURLY_BUDGET,
                    label=label)
            if wait > _SYOBOI_MAX_WAIT:
                # 429 の待ち時間の最中。長く待たず、残り時間つきで失敗させる（呼び出し側は
                # 取れなかった項目を空にして parser_error に残し、あとで解析し直される）
                raise SyobocalRateLimitError(int(wait))
            if wait > 0:
                time.sleep(wait)
            with _syoboi_lock:
                _syoboi_last_time = time.monotonic()
                _record_sent_locked()

        def _rate_limited_get(url, **kwargs):
            global _syoboi_last_time
            is_syoboi = 'syoboi.jp' in str(url)
            # 一時的な失敗はここで飲む。実際「1〜2回失敗して3回目に成功」が多く、
            # 呼び出し側(text_parser)は失敗すると値を空にしてしまうため、解析の
            # 結果が回ごとに変わっていた。
            #
            # ただし再試行は相手に負担をかける。締め出されないよう
            #   - 繋がらなかった時だけ再試行する（HTTPの応答が返っていれば、それが
            #     5xx でもそのまま返す。混んでいる相手を叩き直さない）
            #   - 再試行の前にも最低間隔(_SYOBOI_MIN_INTERVAL)を空ける
            #   - 429 は待ち時間の指示付きなので再試行しない
            # に絞る。
            # 解析中の作品情報の問い合わせは、覚えた分を返す（待ちも通信も無し）
            frame = _parse_frame()
            if frame and not _cacheable(url, kwargs):
                frame = None
            key = _request_key(url, kwargs) if frame else None
            if frame:
                hit, server_fresh = _cached_response(key)
                # 取り直し(fresh)でも、相手が Cache-Control で「まだ新しい」と言っている間は
                # 覚えた分を使う（規約: キャッシュを毎回無効化しない）
                if hit is not None and (server_fresh or not getattr(_parse_local, 'fresh', False)):
                    frame['used'].append(key)
                    return hit
            with (_syoboi_req_lock if is_syoboi else contextlib.nullcontext()):
                return _send(url, kwargs, is_syoboi, frame, key)

        def _send(url, kwargs, is_syoboi, frame, key):
            global _syoboi_last_time
            resp = None
            last_err = None
            for attempt in range(_HTTP_ATTEMPTS):
                _wait_turn(is_syoboi)
                try:
                    resp = _orig_get(url, **kwargs)
                    break
                except requests.RequestException as e:
                    last_err = e
                    resp = None
                    if attempt < _HTTP_ATTEMPTS - 1:
                        time.sleep(_HTTP_BACKOFF * (attempt + 1) * (1 + random.random()))
                finally:
                    if is_syoboi:
                        # 間隔は応答を受け取った（失敗した）時刻から測る（規約: 応答から1秒以上）
                        with _syoboi_lock:
                            _syoboi_last_time = max(_syoboi_last_time, time.monotonic())
            if resp is None:
                raise last_err if last_err else requests.RequestException('取得できませんでした')
            if 'syoboi.jp' in str(url) and resp.status_code == 429:
                retry_after = int(resp.headers.get('Retry-After', 60))
                with _syoboi_lock:
                    # 相手の上限を知るため、規制されるまでに送った回数を残す（この 429 の1回を含む）
                    now = time.time()
                    hour = [t for t in _syoboi_sent if now - t < 3600]
                    n_10min = sum(1 for t in hour if now - t < 600)
                    first = time.strftime('%H:%M:%S', time.localtime(hour[0])) if hour else '-'
                    # 日の枠の区切り（11:00）からの回数。区切りの前なら前日の 11:00 から
                    reset = datetime.now().replace(hour=11, minute=0, second=0, microsecond=0)
                    if reset > datetime.now():
                        reset -= timedelta(days=1)
                    n_day = sum(1 for t in _syoboi_sent if t >= reset.timestamp())
                    n_24h = sum(1 for t in _syoboi_sent if now - t < 86400)
                    _record_ban_locked(retry_after)
                print(f"[syoboi] 429 を受けました。Retry-After={retry_after}秒。"
                      f"この間はしょぼいカレンダーへ問い合わせません url={url} "
                      f"直近の送信: 1時間 {len(hour)}回（最古 {first}）/ 10分 {n_10min}回 / "
                      f"{reset:%m/%d %H:%M} から {n_day}回 / 24時間 {n_24h}回", flush=True)
                raise SyobocalRateLimitError(retry_after)
            if frame and resp.status_code == 200:
                frame['captured'].append((key, resp.url, resp.encoding, resp.content,
                                          resp.headers.get('Cache-Control')))
            return resp
        self.session.get = _rate_limited_get
    
    def get_chid(self, sid: int = None, service_name: str = None) -> Optional[str]:
        """sidまたはサービス名からChIDを取得"""
        if sid and sid in self.SID_TO_CHID:
            return self.SID_TO_CHID[sid]
        
        if service_name:
            for ch_name, ch_id in self.CHANNEL_NAME_TO_CHID.items():
                if ch_name in service_name or service_name in ch_name:
                    return ch_id
        
        return None


# 前回までの規制の期限を読み戻す（再起動しても期限までは問い合わせない）
_load_state()
