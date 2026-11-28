"""予約の番組情報を EPG から取り直す"""

import json
from read_tsprogram.program_info import normalize_text, normalize_extended_info
from text_parser.shoboi_api import background
from .common import logger


def _ids(rsv):
    """予約の (onid, tsid, sid, eid)。"""
    return rsv.get('onid', 0), rsv.get('tsid', 0), rsv.get('sid', 0), rsv.get('eid', 0)


def _epg_meta(ev) -> dict:
    """EDCB の番組情報1件から、番組名(正規化前)・概要・詳細・ジャンル・映像・音声を取り出す。"""
    cont_list  = ev.get('contentInfoList') or []
    component  = ev.get('componentInfo') or {}
    audio_list = ev.get('audioInfoList') or []
    genre = ''
    if cont_list:
        c0 = cont_list[0]
        nibble = c0.get('content_nibble')
        if isinstance(nibble, int):
            from read_tsprogram.constants import ARIB_GENRE_LARGE, ARIB_GENRE_MIDDLE
            n1, n2 = nibble >> 8, nibble & 0xFF
            large = ARIB_GENRE_LARGE.get(n1, '')
            if large:
                mid = (ARIB_GENRE_MIDDLE.get(n1) or {}).get(n2, '')
                genre = f'{large} > {mid}' if mid else large
        else:
            cn = c0.get('component_type_name', {})
            genre = ' > '.join(filter(None, [cn.get('nibble1', ''), cn.get('nibble2', '')])) \
                    if isinstance(cn, dict) else str(cn)
    return {
        'event_name':    (ev.get('shortInfo') or {}).get('event_name', ''),
        'description':   normalize_text((ev.get('shortInfo') or {}).get('text_char', '')),
        'extended_info': normalize_extended_info((ev.get('extInfo') or {}).get('text_char', '')),
        'genre':         genre,
        'video_info':    str(component.get('component_type_name', '')),
        'audio_info':    str(audio_list[0].get('component_type_name', '')) if audio_list else '',
    }


def _to_text(v):
    if v is None:
        return None
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


class _EpgMetaMixin:
    """予約の番組情報を EPG から取り直す"""

    def _refresh_epg_meta(self, rsv, existing):
        """登録済みの予約の EPG メタ情報を取り直す。解析に使う番組情報が変わったら解析し直す。"""
        onid, tsid, sid, eid = _ids(rsv)
        events = self.edcb.enum_event_info(
            f'{onid}-{tsid}-{sid}-{eid}', basic=0)
        if not events:
            return
        ev = events[0]
        meta = _epg_meta(ev)
        epg_title = normalize_text(meta['event_name'])
        updates = dict(
            original_description=meta['description'],
            original_extended_info=meta['extended_info'],
            genre=meta['genre'], video_info=meta['video_info'], audio_info=meta['audio_info'],
        )
        if epg_title:
            updates['original_title'] = epg_title
        if not existing.get('edcb_tag'):
            _bat = (rsv.get('recSetting') or {}).get('batFilePath', '')
            _tag = _bat.split('*', 1)[1] if '*' in _bat else ''
            if _tag:
                updates['edcb_tag'] = _tag
        # 解析に使う番組情報が変わったか。上書きする前に比べる
        epg_changed = any(
            k in updates and (updates[k] or '') != (existing.get(k) or '')
            for k in ('original_title', 'original_description',
                      'original_extended_info'))
        self.db.update_rule(existing['id'], **updates)
        # 番組情報が変わったらその場で解析し直す。1週間先の予約は EPG に
        # シリーズ名しか無く、取り込み時の解析は else に落ちる。放送が近づいて
        # 話数・副題が入っても、ここで上書きするだけだと日次の再解析
        # (_retry_parser_error_rules)は「EPG と保存値の差」で変更を見るため
        # 差が見えず、古い解析のまま録画されていた
        # （実測: 題名の「!」が全角か半角かで、folder が新しいパターンの値に
        #   ならず、取り込み時の値のまま）
        if epg_changed and existing.get('state') != 'recorded':
            try:
                with background():
                    _ok, _res, cv = self._reparse_rule(
                        self.db.get_rule(existing['id']) or existing, sid, onid, tsid)
                logger.info('予約の同期: rule=%d 番組情報が変わったので解析し直しました%s',
                            existing['id'], '（確定値を追従）' if cv else '')
            except Exception as e:
                logger.warning('予約の同期: rule=%d 番組情報の変更後の再解析に失敗: %s',
                               existing['id'], e)
