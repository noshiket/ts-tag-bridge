"""サービス・番組表・番組の検索"""

from typing import Optional
from read_tsprogram.program_info import normalize_text, normalize_extended_info


class _EpgMixin:
    """EDCBClient の一部（サービス・番組表・番組の検索）。"""

    # -------------------------------------------------------------------------
    # EPG
    # -------------------------------------------------------------------------

    def enum_service(self) -> list:
        """サービス（チャンネル）一覧取得"""
        return self._get("EnumService")

    def enum_event_info(
        self,
        id: str,
        *,
        onair: Optional[int] = None,
        basic: int = 1,
        index: int = 0,
        count: int = 200,
    ) -> list:
        """番組情報取得。
        id: 'ONID-TSID-SID' / 'ONID-TSID-SID-EID' / 'ONID-TSID-SID-startTimeUnix'
        basic=0 で詳細情報（event_ext_text, videoInfo 等）も返す
        onair=1 で放送中+次の番組のみ返す
        """
        params = {"id": id, "onair": onair, "basic": basic,
                  "index": index, "count": count}
        items = self._get("EnumEventInfo", params)
        # onair=1で該当が1件のみのとき、EDCBはリストではなくイベントdict単体を返すことがある
        # (次番組が未定の局等)。そのままイテレートするとキー文字列を舐めて落ちるためラップする。
        if isinstance(items, dict):
            items = [items]
        for e in items:
            short = e.get("shortInfo") or {}
            ext   = e.get("extInfo") or {}
            short["event_name"] = normalize_text(short.get("event_name", ""))
            short["text_char"]  = normalize_text(short.get("text_char", ""))
            ext["text_char"]    = normalize_extended_info(ext.get("text_char", ""))
        return items

    def search_event(
        self,
        *,
        andkey: Optional[str] = None,
        notkey: Optional[str] = None,
        service_list: Optional[list] = None,
        days: int = 0,
        archive: bool = False,
        basic: int = 1,
        index: int = 0,
        count: int = 200,
        reg_exp_flag: bool = False,
        title_only_flag: bool = False,
        aimai_flag: bool = False,
        free_ca_flag: Optional[int] = None,
        chk_duration_min: Optional[int] = None,
        chk_duration_max: Optional[int] = None,
        date_list: Optional[str] = None,
        content_list: Optional[list] = None,
        not_content_flag: bool = False,
        not_date_flag: bool = False,
        chk_rec_end: bool = False,
        chk_rec_day: Optional[int] = None,
        chk_rec_no_service: bool = False,
    ) -> list:
        """番組検索。POST で SearchEvent を呼び出す。
        service_list : ["ONID-TSID-SID", ...] で放送局を個別指定（省略時は全局）
        date_list    : "曜-HH:MM-曜-HH:MM" をカンマ区切りで複数指定
                       曜 = 日/月/火/水/木/金/土
        content_list : nibble 値の整数リスト（nibble1*256+nibble2、例: [1792]）
        archive      : True → 過去番組DB(SearchEpgArchive)を使用
        chk_rec_end  : True → 録画済み番組を除外
        chk_rec_day  : 録画済みチェックの対象日数（chk_rec_end=True 時のみ有効、省略時=6）
        chk_rec_no_service : True → 同一サービス以外の録画済みも除外対象に含める
        basic/index/count は query string 経由（POST body ではなく）
        """
        # POST で送ることで GetSearchKey(post) が全パラメータを読む
        # GET の場合は GetSearchKeyKeyword(qs) が使われ andKey のみ有効
        # json/count/index はクエリ文字列から読まれるので params に残す
        body: list[tuple] = [('andKey', andkey if andkey else '')]
        if notkey:              body.append(('notKey', notkey))
        if reg_exp_flag:        body.append(('regExpFlag', '1'))
        if title_only_flag:     body.append(('titleOnlyFlag', '1'))
        if aimai_flag:          body.append(('aimaiFlag', '1'))
        if not_content_flag:    body.append(('notContetFlag', '1'))
        if not_date_flag:       body.append(('notDateFlag', '1'))
        if free_ca_flag:        body.append(('freeCAFlag', str(free_ca_flag)))
        if chk_rec_end:         body.append(('chkRecEnd', '1'))
        if chk_rec_day:         body.append(('chkRecDay', str(chk_rec_day)))
        if chk_rec_no_service:  body.append(('chkRecNoService', '1'))
        if chk_duration_min:    body.append(('chkDurationMin', str(chk_duration_min)))
        if chk_duration_max:    body.append(('chkDurationMax', str(chk_duration_max)))
        if days:                body.append(('days', str(days)))
        if date_list:           body.append(('dateList', date_list))
        # service_list 未指定時は全サービスを送る（GetSearchKeyKeyword と同じ挙動）
        effective_services = service_list
        if effective_services is None and not self.is_demo:
            self._load_service_map()
            effective_services = [f"{o}-{t}-{s}" for o, t, s in self._service_map]
        for s in (effective_services or []):
            body.append(('serviceList', s))
        for c in (content_list or []):
            body.append(('contentList', str(c)))
        if not self.is_demo:
            ctok = self._get_csrf_token('searchevent')
            body.append(('ctok', ctok))

        PAGE = 5000
        all_items: list = []
        offset = 0
        while True:
            qs = {'json': 1, 'count': PAGE, 'index': offset}
            if self.is_demo:
                data = self.mock_handler.handle("POST", "SearchEvent", params=qs, data=dict(body))
            else:
                resp = self.session.post(f"{self.base_url}/api/SearchEvent", params=qs, data=body)
                resp.raise_for_status()
                data = resp.json()
            page = data.get('items', data) if isinstance(data, dict) else data
            if isinstance(page, list):
                all_items.extend(page)
            total = data.get('total', len(all_items)) if isinstance(data, dict) else len(all_items)
            offset += PAGE
            if offset >= total:
                break
        items = all_items
        for e in items:
            short = e.get("shortInfo") or {}
            ext   = e.get("extInfo") or {}
            short["event_name"] = normalize_text(short.get("event_name", ""))
            short["text_char"]  = normalize_text(short.get("text_char", ""))
            ext["text_char"]    = normalize_extended_info(ext.get("text_char", ""))
        return items
