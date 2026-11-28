"""EDCB の値を API の応答の形にする（サービス・番組・予約・録画・自動予約・チューナー）"""

import json as _json
from read_tsprogram.program_info import normalize_text as _nt


_DOW_JP = ['日', '月', '火', '水', '木', '金', '土']


def _parse_json(val):
    """JSON 文字列 → dict/list、None/パース失敗 → None"""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        return _json.loads(val)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# EDCB → レスポンス
# ---------------------------------------------------------------------------

def service_to_response(raw: dict) -> dict:
    return {
        'onid':                   raw['onid'],
        'tsid':                   raw['tsid'],
        'sid':                    raw['sid'],
        'service_name':           raw.get('service_name', ''),
        'remote_control_key_id':  raw.get('remote_control_key_id', 0),
    }


# ARIB STD-B10 コンテント記述子の大分類(nibble1)ラベル
_NIBBLE1_GENRE = {
    0x0: 'ニュース／報道', 0x1: 'スポーツ', 0x2: '情報／ワイドショー', 0x3: 'ドラマ',
    0x4: '音楽', 0x5: 'バラエティ', 0x6: '映画', 0x7: 'アニメ／特撮',
    0x8: 'ドキュメンタリー／教養', 0x9: '劇場／公演', 0xA: '趣味／教育', 0xB: '福祉',
}


def event_to_response(raw: dict, station_name: str = '') -> dict:
    short      = raw.get('shortInfo') or {}
    ext        = raw.get('extInfo') or {}
    cont_list  = raw.get('contentInfoList') or []
    component  = raw.get('componentInfo') or {}
    audio_list = raw.get('audioInfoList') or []

    if cont_list and isinstance(cont_list[0].get('content_nibble'), int):
        # 実EDCB(ctrl_cmd)は {'content_nibble': nibble1*256+nibble2, 'user_nibble': ...} を返す
        content_nibble = cont_list[0]['content_nibble']
        genre = '/'.join(dict.fromkeys(filter(None, (
            _NIBBLE1_GENRE.get(c['content_nibble'] >> 8)
            for c in cont_list if isinstance(c.get('content_nibble'), int)))))
    elif cont_list:
        # mock互換: nibble1/nibble2 形式
        cn = cont_list[0].get('component_type_name', {})
        genre = '/'.join(filter(None, [cn.get('nibble1', ''), cn.get('nibble2', '')])) \
                if isinstance(cn, dict) else str(cn)
        n1 = cont_list[0].get('nibble1')
        n2 = cont_list[0].get('nibble2')
        content_nibble = n1 * 256 + n2 if (n1 is not None and n2 is not None) else None
    else:
        genre = ''
        content_nibble = None

    # 副音声の有無: 別ES副音声(音声コンポーネント2件以上) または デュアルモノ(1ES内に主/副)
    has_secondary_audio = len(audio_list) >= 2 or (
        bool(audio_list) and 'デュアルモノ' in str(audio_list[0].get('component_type_name', ''))
    )

    return {
        'onid':           raw['onid'],
        'tsid':           raw['tsid'],
        'sid':            raw['sid'],
        'event_id':       raw['eid'],
        'start_time':     raw.get('startTime'),
        'duration_sec':   raw.get('durationSecond', 0),
        'station_name':   station_name,
        'title':          short.get('event_name', ''),
        'description':    short.get('text_char', ''),
        'extended_info':  ext.get('text_char', ''),
        'genre':          genre,
        'content_nibble': content_nibble,
        'free_ca':        (not raw['freeCAFlag']) if 'freeCAFlag' in raw else None,
        'video_info':     component.get('component_type_name', ''),
        'audio_info':     audio_list[0].get('component_type_name', '') if audio_list else '',
        'has_secondary_audio': has_secondary_audio,
    }


def reserve_to_response(raw: dict) -> dict:
    return {
        'reserve_id':   raw['reserveID'],
        'title':        raw['title'],
        'station_name': _nt(raw['stationName']),
        'onid':         raw['onid'],
        'tsid':         raw['tsid'],
        'sid':          raw['sid'],
        'event_id':     raw['eid'],
        'start_time':   raw['startTime'],
        'duration_sec': raw.get('durationSecond', 0),
        'comment':      raw.get('comment', ''),
        'overlap_mode': raw.get('overlapMode', 0),
        'rec_enabled':  0 if not raw.get('recSetting', {}).get('recEnabled', True) else 1,
        'rec_setting':  raw.get('recSetting', {}),
        'size':         raw.get('size', ''),
    }


def rec_info_to_response(raw: dict) -> dict:
    short = raw.get('shortInfo') or {}
    ext   = raw.get('extInfo') or {}
    return {
        'id':            raw['id'],
        'rec_file_path': raw.get('recFilePath', ''),
        'title':         raw.get('title', ''),
        'onid':          raw.get('onid'),
        'tsid':          raw.get('tsid'),
        'sid':           raw.get('sid'),
        'event_id':      raw.get('eid'),
        'service_name':  _nt(raw.get('serviceName', '')),
        'start_time':    raw.get('startTime'),
        'duration_sec':  raw.get('durationSecond', 0),
        'drops':         raw.get('drops', 0),
        'scrambles':     raw.get('scrambles', 0),
        'rec_status':    raw.get('recStatus', 0),
        'comment':       raw.get('comment', ''),
        'protect_flag':  raw.get('protectFlag', False),
        'description':   short.get('text_char', ''),
        'extended_info': ext.get('text_char', ''),
    }


def storage_to_response(raw: dict) -> dict:
    return {
        'id':    raw.get('id', ''),
        'name':  raw.get('name', ''),
        'text':  raw.get('text', ''),
        'free':  raw.get('free'),
        'total': raw.get('total'),
        'avail': raw.get('avail'),
    }


def tuner_to_response(raw: dict) -> dict:
    """get_tuner_status() の1チューナー分 → サマリー形式。"""
    reserve_list = raw.get('reserveList') or []
    return {
        'tuner_id':      raw.get('tunerID'),
        'tuner_name':    raw.get('tunerName', ''),
        'reserve_count': len(reserve_list),
    }


def tuner_reserve_to_response(raw: dict) -> dict:
    """enum_tuner_reserve_info の1チューナー分。
    JSON形式では reserveList は reserveID の整数リスト。"""
    reserve_ids = [r if isinstance(r, int) else r.get('reserveID') for r in raw.get('reserveList') or []]
    return {
        'tuner_id':    raw.get('tunerID'),
        'tuner_name':  raw.get('tunerName', ''),
        'reserve_ids': reserve_ids,
    }


# ---------------------------------------------------------------------------
# リクエスト → EDCB引数
# ---------------------------------------------------------------------------

def _rec_setting(body: dict) -> dict:
    mapping = {
        'rec_mode':          'recMode',
        'priority':          'priority',
        'tuijyuu_flag':      'tuijyuuFlag',
        'pittari_flag':      'pittariFlag',
        'tuner_id':          'tunerID',
        'suspend_mode':      'suspendMode',
        'use_def_margin':    'useDefMarginFlag',
        'start_margin':      'startMargin',
        'end_margin':        'endMargin',
        'rec_enabled':       'recEnabled',
        'service_mode':      'serviceMode',
        'partial_rec_flag':  'partialRecFlag',
        'continue_rec_flag': 'continueRecFlag',
        'reboot_flag':       'rebootFlag',
        'rec_folder':        'recFolder',
        'write_plug_in':     'writePlugIn',
        'rec_name_plug_in':  'recNamePlugIn',
        'rec_name':          'recName',
        'bat_file_path':     'batFilePath',
        'bat_file_tag':      'batFileTag',
        'preset_id':         'presetID',
    }
    return {edcb_k: body[k] for k, edcb_k in mapping.items() if k in body}
