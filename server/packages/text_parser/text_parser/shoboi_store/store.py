"""手元の番組表・作品情報の読み書きと引き当て"""

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from typing import Optional
from .. import shoboi_api


_SYNC_INTERVAL = 6 * 3600
_RETRY_AFTER_FAIL = 3600
_PAST_DAYS = 2
_KEEP_DAYS = 31
_FUTURE_DAYS = 8
_CHUNK_DAYS = 2            # 1回の応答は 5,000 件までなので期間を分ける
_MAX_ITEMS = 5000
_FULL_AFTER = 3 * 86400    # 同期がこれより空いたら差分ではなく全部取り直す
_CURSOR_MARGIN = 3600      # 差分の起点は前回の同期の開始より少し前にする（時計のずれ）
# 同期からこれ以内なら、番組表に無い番組は「しょぼいカレンダーに無い」として問い合わせない
_PROGS_FRESH_FOR = 12 * 3600
# 作品情報は同期のたびに変わったかを確かめる。同期が1回抜けても使えるようにする
_TITLES_FRESH_FOR = 36 * 3600
_TITLE_CHUNK = 100

_lock = threading.Lock()
_TS = '%Y-%m-%d %H:%M:%S'


def _conn():
    path = shoboi_api.PARSE_CACHE_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = sqlite3.connect(path, timeout=10)
    c.execute("CREATE TABLE IF NOT EXISTS store_progs (pid TEXT PRIMARY KEY, tid TEXT, chid TEXT, "
              "st_time TEXT, ed_time TEXT, count TEXT, subtitle TEXT, prog_comment TEXT, "
              "flag TEXT, warn TEXT, deleted INTEGER, last_update TEXT)")
    c.execute("CREATE INDEX IF NOT EXISTS store_progs_ch ON store_progs (chid, st_time)")
    c.execute("CREATE TABLE IF NOT EXISTS store_titles (tid TEXT PRIMARY KEY, info TEXT, "
              "subtitles TEXT, last_update TEXT, checked_at REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS store_title_names (tid TEXT PRIMARY KEY, title TEXT, "
              "last_update TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS store_state (key TEXT PRIMARY KEY, value TEXT)")
    return c


def _state(c) -> dict:
    return {k: json.loads(v) for k, v in c.execute("SELECT key, value FROM store_state")}


def _set_state(c, **kv) -> None:
    for k, v in kv.items():
        c.execute("INSERT OR REPLACE INTO store_state (key, value) VALUES (?, ?)", (k, json.dumps(v)))


# ── 応答を保存する ────────────────────────────────────────────────

def save_prog_items(items) -> None:
    rows = []
    for it in items:
        pid = it.findtext('PID', '')
        if not pid:
            continue
        rows.append((pid, it.findtext('TID', ''), it.findtext('ChID', ''),
                     it.findtext('StTime', ''), it.findtext('EdTime', ''), it.findtext('Count', ''),
                     it.findtext('STSubTitle', '') or it.findtext('SubTitle', ''),
                     it.findtext('ProgComment', ''), it.findtext('Flag', ''), it.findtext('Warn', ''),
                     1 if it.findtext('Deleted', '') == '1' else 0, it.findtext('LastUpdate', '')))
    if not rows:
        return
    try:
        with _lock:
            c = _conn()
            try:
                c.executemany("INSERT OR REPLACE INTO store_progs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
                c.commit()
            finally:
                c.close()
    except Exception as e:
        print(f"[shoboi store] 番組の保存に失敗: {e}", flush=True)


def title_info_from_item(it, finder) -> dict:
    tid = it.findtext('TID', '')
    wt, wu = finder._extract_wiki_from_keywords(it.findtext('Keywords', ''))
    return {'tid': tid, 'title': it.findtext('Title', ''), 'short_title': it.findtext('ShortTitle', ''),
            'title_yomi': it.findtext('TitleYomi', ''), 'title_en': it.findtext('TitleEN', ''),
            'first_year': it.findtext('FirstYear', ''), 'first_month': it.findtext('FirstMonth', ''),
            'wiki_title': wt, 'wiki_url': wu}


def save_title_items(items, finder, now: float = None) -> None:
    import re
    now = now if now is not None else time.time()
    rows = []
    for it in items:
        tid = it.findtext('TID', '')
        if not tid:
            continue
        subs = [{'count': m.group(1), 'subtitle': m.group(2).strip()}
                for m in re.finditer(r'\*(\d+)\*([^\*\n]+)', it.findtext('SubTitles', '') or '')]
        rows.append((tid, json.dumps(title_info_from_item(it, finder), ensure_ascii=False),
                     json.dumps(subs, ensure_ascii=False), it.findtext('LastUpdate', ''), now))
    if not rows:
        return
    try:
        with _lock:
            c = _conn()
            try:
                c.executemany("INSERT OR REPLACE INTO store_titles VALUES (?,?,?,?,?)", rows)
                c.commit()
            finally:
                c.close()
    except Exception as e:
        print(f"[shoboi store] 作品の保存に失敗: {e}", flush=True)


def save_title_names(items) -> None:
    rows = [(it.findtext('TID', ''), it.findtext('Title', ''), it.findtext('LastUpdate', ''))
            for it in items if it.findtext('TID', '')]
    if not rows:
        return
    with _lock:
        c = _conn()
        try:
            c.executemany("INSERT OR REPLACE INTO store_title_names VALUES (?,?,?)", rows)
            c.commit()
        finally:
            c.close()


# ── 手元から答える ────────────────────────────────────────────────

def title_names() -> list:
    """全作品の [(TID, 作品名, 作品情報 or None)]。作品情報（略称・読みなど）は覚えている作品だけ。"""
    try:
        with _lock:
            c = _conn()
            try:
                rows = c.execute("SELECT n.tid, n.title, t.info FROM store_title_names n "
                                 "LEFT JOIN store_titles t ON t.tid = n.tid").fetchall()
            finally:
                c.close()
    except Exception:
        return []
    return [(tid, name, json.loads(info) if info else None) for tid, name, info in rows]


def title(tid) -> Optional[dict]:
    """覚えた作品情報 {'info':…, 'subtitles':[…]}。確かめてから日が経っていれば None。

    全話の副題は作品情報(TitleLookup)の一覧に、番組表にある同じ作品の回（話数と副題）を
    足したもの。作品の一覧への登録が番組表より遅れた回も取りこぼさないため。各回の
    'from' が取得元（'title'=作品情報、'program'=番組表）。両方にある回は作品情報を使う。
    """
    if not tid:
        return None
    try:
        with _lock:
            c = _conn()
            try:
                row = c.execute("SELECT info, subtitles, checked_at FROM store_titles WHERE tid = ?",
                                (str(tid),)).fetchone()
                progs = c.execute("SELECT count, subtitle FROM store_progs WHERE tid = ? AND deleted = 0 "
                                  "AND subtitle != '' ORDER BY st_time", (str(tid),)).fetchall() if row else []
            finally:
                c.close()
    except Exception:
        return None
    if not row or time.time() - (row[2] or 0) > _TITLES_FRESH_FOR:
        return None
    subs = [{**e, 'from': 'title'} for e in json.loads(row[1] or '[]')]
    have = {int(e['count']) for e in subs if str(e['count']).isdigit()}
    for count, subtitle in progs:
        if str(count).isdigit() and int(count) not in have:
            have.add(int(count))
            subs.append({'count': str(int(count)), 'subtitle': subtitle, 'from': 'program'})
    subs.sort(key=lambda e: int(e['count']) if str(e['count']).isdigit() else 0)
    return {'info': json.loads(row[0]), 'subtitles': subs}


def _subtitle_of(tid, count, fallback):
    t = title(tid)
    if t and count and str(count).isdigit():
        for e in t['subtitles']:
            if int(e['count']) == int(count):
                return e['subtitle']
    return fallback


def _fresh_state(c):
    st = _state(c)
    if time.time() - st.get('synced_at', 0) > _PROGS_FRESH_FOR:
        return None
    return st


def program_at(ch_id, target_dt: datetime, tolerance_min: int):
    """(番組表で答えられるか, 番組)。番組は search_program と同じ形。

    番組表が新しく、その局・時刻が取った範囲に入っていれば、見つからなくても
    (True, None)（しょぼいカレンダーに無い番組なので問い合わせない）。
    """
    try:
        with _lock:
            c = _conn()
            try:
                st = _fresh_state(c)
                if not st or str(ch_id) not in st.get('chids', []):
                    return False, None
                if not (st['from'] <= target_dt.strftime(_TS) <= st['to']):
                    return False, None
                lo = (target_dt - timedelta(minutes=tolerance_min)).strftime(_TS)
                hi = (target_dt + timedelta(minutes=tolerance_min)).strftime(_TS)
                rows = c.execute("SELECT pid, tid, st_time, ed_time, count, subtitle FROM store_progs "
                                 "WHERE chid = ? AND deleted = 0 AND st_time BETWEEN ? AND ?",
                                 (str(ch_id), lo, hi)).fetchall()
            finally:
                c.close()
    except Exception:
        return False, None
    best = None
    for pid, tid, st_time, ed_time, count, subtitle in rows:
        diff = abs((datetime.strptime(st_time, _TS) - target_dt).total_seconds() / 60)
        if best is None or diff < best['time_diff_min']:
            best = {'pid': pid, 'tid': tid, 'start_time': st_time, 'end_time': ed_time,
                    'count': count, 'subtitle': subtitle, 'time_diff_min': diff}
    if best:
        best['subtitle'] = _subtitle_of(best['tid'], best['count'], best['subtitle'])
    return True, best


def has_program(sid, start_time) -> bool:
    """その局・時刻の番組が手元の番組表にあるか（取り直した後に解析し直す対象を選ぶ）。"""
    try:
        ch = shoboi_api.CompleteProgramFinder.SID_TO_CHID.get(int(sid))
        dt = datetime.fromisoformat(str(start_time)).replace(tzinfo=None)
    except (TypeError, ValueError):
        return False
    return ch is not None and program_at(ch, dt, 10)[1] is not None


def window():
    """手元の番組表が答えられる期間 (始まり, 終わり)（naive の datetime）。番組表が古ければ None。"""
    try:
        with _lock:
            c = _conn()
            try:
                st = _fresh_state(c)
            finally:
                c.close()
    except Exception:
        return None
    if not st or not st.get('from') or not st.get('to'):
        return None
    return datetime.strptime(st['from'], _TS), datetime.strptime(st['to'], _TS)


def info_for(sid, start_time) -> Optional[dict]:
    """その局・時刻の放送について、手元の番組表・作品情報から分かることをまとめる。

    予約・録画の記録(shoboi_info)に書いて詳細画面に出す。手元の番組表の範囲外なら None
    （分からない）、範囲内で番組表に無ければ {}（しょぼいカレンダーに無い番組）。
    作品情報がまだ無ければ番組表の分だけ入る（作品名などは次の取り直しで入る）。
    """
    try:
        ch = shoboi_api.CompleteProgramFinder.SID_TO_CHID.get(int(sid))
        dt = datetime.fromisoformat(str(start_time)).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None
    if ch is None:
        return None
    covered, prog = program_at(ch, dt, 10)
    if not covered:
        return None
    if not prog:
        return {}
    tid = prog.get('tid') or ''
    info = {'pid': prog.get('pid') or '', 'tid': tid, 'count': prog.get('count') or '',
            'subtitle': prog.get('subtitle') or '', 'st_time': prog.get('start_time') or '',
            'ed_time': prog.get('end_time') or '',
            'url': f'https://cal.syoboi.jp/tid/{tid}' if tid else ''}
    extra = program_by_pid(info['pid']) if info['pid'] else None
    if extra:
        info.update(prog_comment=extra['prog_comment'], flag=extra['flag'], warn=extra['warn'])
    t = title(tid) if tid else None
    if t:
        ti = t['info']
        info.update(title=ti.get('title') or '', short_title=ti.get('short_title') or '',
                    title_yomi=ti.get('title_yomi') or '', wiki_title=ti.get('wiki_title') or '',
                    wiki_url=ti.get('wiki_url') or '')
    return info


def waits_for_program_info(errors) -> bool:
    """番組情報が取れずに残ったエラー（規制で後回し、または getFromSid などで取れなかった）か。"""
    if isinstance(errors, str):
        try:
            errors = json.loads(errors)
        except ValueError:
            errors = [errors]
    return any(shoboi_api.is_rate_limited_error(e) or 'getFromSid' in str(e)
               or 'getFromTitleAndEpisode' in str(e) for e in (errors or []))


def program_by_pid(pid) -> Optional[dict]:
    """番組表が新しければ、その PID の注意書き(ProgComment)・Flag・Warn。"""
    try:
        with _lock:
            c = _conn()
            try:
                if not _fresh_state(c):
                    return None
                row = c.execute("SELECT prog_comment, flag, warn FROM store_progs WHERE pid = ?",
                                (str(pid),)).fetchone()
            finally:
                c.close()
    except Exception:
        return None
    if not row:
        return None
    return {'prog_comment': row[0] or '', 'flag': row[1] or '', 'warn': row[2] or ''}
