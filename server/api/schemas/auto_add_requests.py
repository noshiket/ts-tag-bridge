"""EPG 自動予約の要求の読み方（EDCB の形へ直す・一部だけの変更を重ねる）"""

from .edcb import _DOW_JP, _rec_setting
from .edcb_rules import auto_add_to_response


# 存在ベースboolean(Luaはキーの有無で判定するためfalseはキー省略で表現する)
_AUTO_ADD_PRESENCE_BOOLS = [
    ('reg_exp_flag', 'regExpFlag'), ('title_only_flag', 'titleOnlyFlag'),
    ('aimai_flag', 'aimaiFlag'), ('case_flag', 'caseFlag'),
    ('chk_rec_end', 'chkRecEnd'), ('chk_rec_no_service', 'chkRecNoService'),
    ('not_content_flag', 'notContetFlag'), ('not_date_flag', 'notDateFlag'),
    ('disable_flag', 'disableFlag'),
]


def parse_auto_add_request(body: dict) -> dict:
    """POST/PATCH /api/auto_add"""
    params = {}

    # 文字列・整数パラメータ
    for k, ek in [('and_key', 'andKey'), ('not_key', 'notKey'), ('network', 'network'),
                  ('note', 'note'),
                  ('free_ca_flag', 'freeCAFlag'), ('chk_rec_day', 'chkRecDay'),
                  ('chk_duration_min', 'chkDurationMin'), ('chk_duration_max', 'chkDurationMax'),
                  ('days', 'days')]:
        if k in body:
            params[ek] = body[k]

    # 存在ベースの boolean フラグ: true → キーを送信、false → キーを省略（Lua は存在で判定）
    for k, ek in _AUTO_ADD_PRESENCE_BOOLS:
        if k in body:
            if body[k]:
                params[ek] = 1
            # false の場合はキーを含めない（EDCBが未設定と解釈）

    # serviceList: [{onid, tsid, sid}, ...] → ["ONID-TSID-SID", ...]
    if 'service_list' in body:
        params['serviceList'] = [
            f"{s['onid']}-{s['tsid']}-{s['sid']}" for s in body['service_list']
        ]

    # contentList: [{content_nibble: int}, ...] → [int, ...]
    if 'content_list' in body:
        params['contentList'] = [
            c['content_nibble'] if isinstance(c, dict) else int(c)
            for c in body['content_list']
        ]

    # dateList: [{startDayOfWeek,startHour,startMin,endDayOfWeek,endHour,endMin}, ...]
    # → "日-HH:MM-日-HH:MM,月-HH:MM-月-HH:MM" 形式のカンマ区切り文字列
    if 'date_list' in body and body['date_list']:
        parts = []
        for d in body['date_list']:
            s_dow = _DOW_JP[d['startDayOfWeek']]
            e_dow = _DOW_JP[d['endDayOfWeek']]
            parts.append(f"{s_dow}-{d['startHour']:02d}:{d['startMin']:02d}"
                         f"-{e_dow}-{d['endHour']:02d}:{d['endMin']:02d}")
        params['dateList'] = ','.join(parts)

    params.update(_rec_setting(body))
    return params


def auto_add_to_edcb_params(raw: dict) -> dict:
    """EnumAutoAddの1件をSetAutoAddのPOSTパラメータへ逆変換する。

    PATCH /api/auto_add/<id> を部分更新として扱うためのベース。SetAutoAddは全置換のため、
    既存ルールをこの形へ戻した上に送られたフィールドだけ上書きして送る。"""
    from clients.edcb_api.common import _rec_setting_to_post_params

    resp = auto_add_to_response(raw)
    s = resp['search_info']
    body = {
        'and_key': s['and_key'], 'not_key': s['not_key'], 'note': resp['note'],
        'free_ca_flag': s['free_ca_flag'], 'chk_rec_day': s['chk_rec_day'],
        'chk_duration_min': s['chk_duration_min'], 'chk_duration_max': s['chk_duration_max'],
        'reg_exp_flag': s['reg_exp_flag'], 'title_only_flag': s['title_only_flag'],
        'aimai_flag': s['aimai_flag'], 'case_flag': s['case_flag'],
        'chk_rec_end': s['chk_rec_end'], 'chk_rec_no_service': s['chk_rec_no_service'],
        'not_content_flag': s['not_content_flag'], 'not_date_flag': s['not_date_flag'],
        'disable_flag': resp['disable_flag'],
        'service_list': s['service_list'],
        'content_list': s['content_list'],
        'date_list': s['date_list'],
    }
    params = parse_auto_add_request(body)
    rs = raw.get('recSetting') or {}
    params.update(_rec_setting_to_post_params(rs))
    # 自動予約の「録画無効」はrecMode=5で表現される(SetAutoAddのGetRecSettingは
    # recEnabled!=1でrecMode=5にする)。無効ルールを部分更新しても無効のまま維持する。
    if rs.get('recMode') == 5:
        params['recEnabled'] = 0
    return params


def merge_auto_add_patch(current_raw: dict, body: dict) -> dict:
    """PATCH /api/auto_add/<id> の部分更新: 既存ルール(EnumAutoAddの1件)をベースに
    bodyで送られたフィールドだけ上書きしたSetAutoAddパラメータを返す。

    存在ベースbooleanとリスト系は「bodyで明示的にfalse/空」の場合にベースのキーを
    外すことでOFF/全解除できるようにする(省略=現状維持)。"""
    params = auto_add_to_edcb_params(current_raw)
    for k, ek in _AUTO_ADD_PRESENCE_BOOLS:
        if k in body and not body[k]:
            params.pop(ek, None)
    for k, ek in (('service_list', 'serviceList'), ('content_list', 'contentList'),
                  ('date_list', 'dateList')):
        if k in body and not body[k]:
            params.pop(ek, None)
    params.update(parse_auto_add_request(body))
    return params
