"""ルールに当たる EPG 自動予約の候補と、ルールへの自動予約の紐づけ"""

from quart import jsonify, abort
from api import schemas
from api.routes.auth import bp
from api.routes.edcb_call import _call, _client
from api.routes.caches import _json
from api.routes.parser import _ruledb


def _genre_matches(si: dict, genre: str) -> bool:
    """ルールのジャンル指定（content_list）に番組のジャンルが合うか。

    番組のジャンルは予約の取り込みで「大分類 > 中分類」の文字で持っている（EDCB の名前）。
    ルールは content_nibble（大分類<<8 | 中分類。中分類 0xFF は大分類すべて）で持つので、
    ARIB の名前の表で文字にして比べる。番組のジャンルが分からない時・指定が無い時は絞らない。
    not_content_flag は「指定したジャンルを除く」。
    """
    import unicodedata as _uc
    from read_tsprogram.constants import ARIB_GENRE_LARGE, ARIB_GENRE_MIDDLE
    cl = [c for c in (si.get('content_list') or []) if isinstance(c, dict) and isinstance(c.get('content_nibble'), int)]
    if not cl or not genre:
        return True
    norm = lambda x: _uc.normalize('NFKC', x or '').replace(' ', '')
    big, _, mid = genre.partition(' > ')
    big, mid = norm(big), norm(mid)
    def hit(cn: int) -> bool:
        n1, n2 = cn >> 8, cn & 0xFF
        if norm(ARIB_GENRE_LARGE.get(n1)) != big:
            return False
        return n2 == 0xFF or not mid or norm((ARIB_GENRE_MIDDLE.get(n1) or {}).get(n2)) == mid
    return any(hit(c['content_nibble']) for c in cl) != bool(si.get('not_content_flag'))


def _date_matches(si: dict, start) -> bool:
    """ルールの時間帯（date_list）に番組の開始時刻が入るか（EDCB と同じく開始時刻で見る）。

    曜日は 0=日曜。終わりが始まりより前なら週をまたぐ。not_date_flag は「指定した時間帯を除く」。
    時間帯の指定が無い時・開始時刻が分からない時は絞らない。
    """
    dl = [d for d in (si.get('date_list') or []) if isinstance(d, dict)]
    if not dl or start is None:
        return True
    t = ((start.weekday() + 1) % 7) * 1440 + start.hour * 60 + start.minute

    def inside(d) -> bool:
        a = d.get('startDayOfWeek', 0) * 1440 + d.get('startHour', 0) * 60 + d.get('startMin', 0)
        b = d.get('endDayOfWeek', 0) * 1440 + d.get('endHour', 0) * 60 + d.get('endMin', 0)
        return a <= t <= b if a <= b else (t >= a or t <= b)
    return any(inside(d) for d in dl) != bool(si.get('not_date_flag'))


def _duration_matches(si: dict, minutes) -> bool:
    """番組の長さ（分）がルールの最短〜最長に入るか。0 は制限なし。長さが分からない時は絞らない。"""
    if minutes is None:
        return True
    lo, hi = si.get('chk_duration_min') or 0, si.get('chk_duration_max') or 0
    return (not lo or minutes >= lo) and (not hi or minutes <= hi)


def _program_times(program: dict):
    """予約の開始時刻（その土地の時刻）と長さ（分）。分からなければ None"""
    from datetime import datetime as _dt
    try:
        st = _dt.fromisoformat(program.get('start_time') or '')
    except ValueError:
        return None, None
    try:
        en = _dt.fromisoformat(program.get('expected_end_time') or '')
        minutes = (en - st).total_seconds() / 60
    except (ValueError, TypeError):
        minutes = None
    return st, minutes


def _epg_auto_add_candidates(program: dict, comment: str, rules: list) -> list:
    """予約のcommentとauto-addルール一覧からマッチ候補を返す。

    手順:
    1. comment が "EPG自動予約" 系でなければ空リスト
    2. commentのandKey有無でルールを事前フィルタ
    3. 各ルールの検索条件（andKey/notKey/serviceList/時間帯/番組の長さ/ジャンル）で照合
    """
    from logic.recordings.epg_auto_add import comment_key_of, keys_match

    comment_key = comment_key_of(comment)
    if comment_key is None:
        return None  # EPG自動予約でない（確定）

    start, minutes = _program_times(program)
    candidates = []
    for rule in rules:
        si = rule.get('search_info', {})
        if not keys_match(program, comment_key, si.get('and_key', ''), si.get('not_key', '') or '',
                          si.get('title_only_flag', False), si.get('reg_exp_flag', False),
                          si.get('service_list', []) or []):
            continue
        # 時間帯・番組の長さ照合
        if not _date_matches(si, start) or not _duration_matches(si, minutes):
            continue
        candidates.append(rule)

    # ジャンルで絞る（アニメのルールがドラマの予約の候補に出ていた）。合うものが無ければ候補なし。
    # 絞らずに残すと、除外キーで外れたルールの代わりに合わないルールが1件だけ残り、それを覚えてしまう
    # （別のサーバーの 3310: ドラマのルールは除外キーで外れ、アニメのルールが残った）。
    # 予約が持つジャンルは番組の最初の1つだけなので、2つ目以降のジャンルで当てたルールは出ない（間違いを出すよりよい）
    return [r for r in candidates if _genre_matches(r.get('search_info', {}), program.get('genre') or '')]


@bp.get('/rules/<int:rule_id>/auto_add_candidates')
def get_auto_add_candidates(rule_id):
    """EPG自動予約候補を返す。
    - DBにauto_add_idが設定済みなら即返す
    - 未設定ならEDCBの予約comment + 検索条件でマッチング
    - 候補が1件なら自動保存
    """
    db = _ruledb()
    program = db.get_rule(rule_id)
    if not program:
        abort(404, description='ルールが見つかりません')

    rules = _call(_client().enum_auto_add)
    adapted = [schemas.auto_add_to_response(r) for r in rules]

    # 既に設定済みならそのルールを返す
    if program.get('auto_add_id') is not None:
        matched = [a for a in adapted if a['id'] == program['auto_add_id']]
        return jsonify({'candidates': matched, 'saved': True, 'auto_add_id': program['auto_add_id']})

    # EDCBからcommentを取得
    reserves = _call(_client().enum_reserve_info)
    reserve = next((r for r in reserves if r['reserveID'] == program.get('reserve_id')), None)
    comment = reserve.get('comment', '') if reserve else ''

    candidates = _epg_auto_add_candidates(program, comment, adapted)

    # None = EPG自動予約でない（確定）→ センチネル 0 を保存して再チェックを防ぐ
    if candidates is None:
        db.set_auto_add_id(rule_id, 0)
        return jsonify({'candidates': [], 'saved': True, 'auto_add_id': 0})

    saved = False
    auto_add_id = None
    if len(candidates) == 1:
        auto_add_id = candidates[0]['id']
        db.set_auto_add_id(rule_id, auto_add_id)
        saved = True

    return jsonify({'candidates': candidates, 'saved': saved, 'auto_add_id': auto_add_id})


@bp.post('/rules/<int:rule_id>/auto_add_id')
async def set_rule_auto_add_id(rule_id):
    """EPG自動予約ルールIDを手動設定（複数候補から選択時）"""
    db = _ruledb()
    if not db.get_rule(rule_id):
        abort(404, description='ルールが見つかりません')
    auto_add_id = (await _json()).get('auto_add_id')
    db.set_auto_add_id(rule_id, auto_add_id)
    return jsonify({'ok': True, 'auto_add_id': auto_add_id})
