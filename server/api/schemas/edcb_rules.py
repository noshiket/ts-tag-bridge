"""EDCB の自動予約・プログラム予約の応答の形（キーワードの直し方）"""

import re


def _decode_and_key(raw_and_key: str) -> tuple:
    """EDCBのandKey埋め込みフラグを分解する(lua ParseAndKey相当)。

    EnumAutoAddのJSON経路は生のsearchInfoを返すため、無効(^!{999})・大文字小文字区別
    (C!{999})はandKeyの先頭プレフィックスとして届く。(and_key, disable, case)を返す。"""
    s = raw_and_key or ''
    disable = s.startswith('^!{999}')
    if disable:
        s = s[len('^!{999}'):]
    case = s.startswith('C!{999}')
    if case:
        s = s[len('C!{999}'):]
    return s, disable, case


def _decode_not_key(raw_not_key: str) -> tuple:
    """EDCBのnotKey埋め込みメモ(:note:～)を分解する(lua ParseNotKey相当)。

    形式: ':note:<エスケープ済メモ>[ <notKey本体>]'。メモは最初の全角/半角スペースまで。
    エスケープ: \\s=半角スペース, \\m=全角スペース, \\\\=\\。(not_key, note)を返す。"""
    s = raw_not_key or ''
    if not s.startswith(':note:'):
        return s, ''
    body = s[len(':note:'):]
    m1 = re.match(r'(.*?　)', body)
    m2 = re.match(r'([^ ]* ?)', body)
    token = m1.group(1) if m1 else (m2.group(1) if m2 else '')
    rest = body[len(token):]
    note = token.rstrip(' 　').replace('\\s', ' ').replace('\\m', '　').replace('\\\\', '\\')
    return rest, note


def auto_add_to_response(raw: dict) -> dict:
    s = raw.get('searchInfo', {})
    and_key, disable_flag, case_flag = _decode_and_key(s.get('andKey', ''))
    not_key, note = _decode_not_key(s.get('notKey', ''))
    return {
        'id':           raw['dataID'],
        'add_count':    raw.get('addCount', 0),
        'disable_flag': disable_flag or bool(s.get('disableFlag', False)),
        'note':         note or s.get('note', ''),
        'search_info': {
            'and_key':            and_key,
            'not_key':            not_key,
            'reg_exp_flag':       bool(s.get('regExpFlag', False)),
            'title_only_flag':    bool(s.get('titleOnlyFlag', False)),
            'aimai_flag':         bool(s.get('aimaiFlag', False)),
            'case_flag':          case_flag or bool(s.get('caseFlag', False)),
            'free_ca_flag':       s.get('freeCAFlag', 0),
            'chk_rec_end':        bool(s.get('chkRecEnd', False)),
            'chk_rec_day':        s.get('chkRecDay', 0),
            'chk_duration_min':   s.get('chkDurationMin', 0),
            'chk_duration_max':   s.get('chkDurationMax', 0),
            'chk_rec_no_service': bool(s.get('chkRecNoService', False)),
            'not_content_flag':   bool(s.get('notContetFlag', False)),
            'not_date_flag':      bool(s.get('notDateFlag', False)),
            'content_list':       s.get('contentList', []),
            'date_list':          s.get('dateList', []),
            'service_list':       s.get('serviceList', []),
        },
        'rec_setting': raw.get('recSetting', {}),
    }


def manu_add_to_response(raw: dict) -> dict:
    return {
        'id':               raw['dataID'],
        'title':            raw.get('title', ''),
        'station_name':     raw.get('stationName', ''),
        'onid':             raw.get('onid'),
        'tsid':             raw.get('tsid'),
        'sid':              raw.get('sid'),
        'start_time':       raw.get('startTime'),
        'duration_sec':     raw.get('durationSecond', 0),
        'day_of_week_flag': raw.get('dayOfWeekFlag', 0),
        'rec_setting':      raw.get('recSetting', {}),
    }
