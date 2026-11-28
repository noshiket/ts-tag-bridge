"""受け取る要求の読み取り（予約・自動予約・検索・プログラム予約・パターンの文脈）"""

from .edcb import _DOW_JP, _rec_setting  # noqa: F401


def parse_reserve_request(body: dict) -> tuple[str, dict]:
    """POST /api/reserves → ('epg'|'manual', kwargs)"""
    if 'event_id' in body:
        return 'epg', {'id': body['event_id'], **_rec_setting(body)}
    return 'manual', {
        'startdate': body.get('start_date', ''),
        'starttime': body.get('start_time', ''),
        'endtime':   body.get('end_time', ''),
        'service':   body.get('service_id', ''),
        'title':     body.get('title'),
        **_rec_setting(body),
    }


def parse_reserve_update(body: dict) -> dict:
    """PATCH /api/reserves/<id>"""
    return _rec_setting(body)


def parse_search_request(body: dict) -> dict:
    """POST /api/search — auto_add と同じ JSON フォーマットを search_event() の kwargs に変換。
    rec_setting / add_count など auto_add 専用フィールドは無視する。
    """
    kwargs = {}

    if 'and_key' in body:
        kwargs['andkey'] = body['and_key']
    if 'not_key' in body:
        kwargs['notkey'] = body['not_key']
    if 'days' in body:
        kwargs['days'] = body['days']

    # boolean フラグ
    for k in ('reg_exp_flag', 'title_only_flag', 'aimai_flag',
              'not_content_flag', 'not_date_flag', 'chk_rec_end', 'chk_rec_no_service'):
        if k in body:
            kwargs[k] = bool(body[k])

    # 整数パラメータ
    for k in ('free_ca_flag', 'chk_duration_min', 'chk_duration_max', 'chk_rec_day'):
        if k in body:
            kwargs[k] = body[k]

    # search 専用パラメータ
    for k in ('archive', 'basic', 'index', 'count'):
        if k in body:
            kwargs[k] = body[k]

    # service_list: [{onid, tsid, sid}] → ["ONID-TSID-SID", ...]
    if 'service_list' in body:
        kwargs['service_list'] = [
            f"{s['onid']}-{s['tsid']}-{s['sid']}" for s in body['service_list']
        ]

    # content_list: [{content_nibble: int}] → [int, ...]
    if 'content_list' in body:
        kwargs['content_list'] = [
            c['content_nibble'] if isinstance(c, dict) else int(c)
            for c in body['content_list']
        ]

    # date_list: [{startDayOfWeek,...}] → "日-HH:MM-日-HH:MM,..." (カンマ区切り)
    if 'date_list' in body and body['date_list']:
        parts = []
        for d in body['date_list']:
            s_dow = _DOW_JP[d['startDayOfWeek']]
            e_dow = _DOW_JP[d['endDayOfWeek']]
            parts.append(f"{s_dow}-{d['startHour']:02d}:{d['startMin']:02d}"
                         f"-{e_dow}-{d['endHour']:02d}:{d['endMin']:02d}")
        kwargs['date_list'] = ','.join(parts)

    return kwargs


def parse_manu_add_request(body: dict) -> dict:
    """POST/PATCH /api/manu_add"""
    return {
        'start_time':       body.get('start_time', ''),
        'end_time':         body.get('end_time', ''),
        'service_id':       body.get('service_id', ''),
        'day_of_week_flag': body.get('day_of_week_flag', 127),
        'title':            body.get('title'),
        **_rec_setting(body),
    }


# ---------------------------------------------------------------------------
# パターン照合コンテキスト（check / search 共通）
# ---------------------------------------------------------------------------

_PATTERN_CONTEXT_FIELDS = ('title', 'start_time', 'extended_info', 'description', 'sid')


def parse_pattern_context(body: dict) -> tuple[str, dict, int]:
    """POST /api/patterns/check・search のボディを検証して (text, context, sid) を返す。

    context は {title, start_time, extended_info, description, sid} の固定構造。
    text = context['title']、sid はパーサー選択に使用。

    Returns:
        (text, context, sid)

    Raises:
        ValueError: 必須フィールドが不足している場合
    """
    ctx = body.get('context')
    if not isinstance(ctx, dict):
        raise ValueError('context オブジェクトが必要です')
    missing = [f for f in _PATTERN_CONTEXT_FIELDS if f not in ctx]
    if missing:
        raise ValueError(f'context に必須フィールドがありません: {", ".join(missing)}')
    sid = ctx['sid']
    if not isinstance(sid, int):
        raise ValueError('context.sid は整数である必要があります')
    ctx = {
        'title':         ctx['title'],
        'start_time':    ctx['start_time'],
        'description':   ctx['description'],
        'extended_info': ctx['extended_info'],
        'sid':           sid,
    }
    text = ctx['title']
    return text, ctx, sid
