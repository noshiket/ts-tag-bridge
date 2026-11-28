"""サービスと時刻からの情報"""

from typing import Dict, List, Any, Optional, Union


class _BySidMixin:
    """ShoboiInfoFetcher の一部（サービスと時刻からの情報）。"""

    def get_all_info_from_sid_and_time(
        self,
        sid: int,
        start_time: str,
        time_tolerance_min: int = 10,
        fetch_wiki: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        SID と放送日時からしょぼいカレンダーの全情報を取得する

        Args:
            sid: サービスID
            start_time: 放送開始時刻 (YYYY-MM-DD HH:MM:SS)
            time_tolerance_min: 時刻の許容誤差（分）
            fetch_wiki: True の場合、Wikipedia 情報も取得する

        Returns:
            以下のキーを持つ辞書。取得失敗時は None。
            {
                'sid-episode_number': int or list or None,
                'sid-episode_name':   str,
                'sid-title':          str,
                'sid-short_title':    str,
                'sid-furigana':       str,
                'sid-tid':            str,
                'sid-pid':            str,
                'sid-announce':       str,
                'sid-wiki_title':     str or None,
            }
        """
        ch_id = self.finder.get_chid(sid=sid)
        if not ch_id:
            return None

        prog_info = self.finder.search_program(ch_id, start_time, time_tolerance_min)
        if not prog_info:
            return None

        tid = prog_info.get('tid', '')
        title_info = self.finder.get_title_info(tid) or {} if tid else {}

        # count → 話数（int またはリスト）
        count_str = str(prog_info.get('count', ''))
        episode_num: Union[int, List[int], None] = None
        if count_str and count_str.isdigit():
            episode_num = int(count_str)
        elif count_str:
            episode_num = self.extract_episodes_from_text(count_str)
        if episode_num is None:
            episode_num = self.extract_episodes_from_text(prog_info.get('subtitle', ''))

        pid = prog_info.get('pid') or ''

        # announce: テロップ・繰り下げなど放送異常情報
        if not pid:
            announce = 'none(no pid)'
        else:
            try:
                irregularity = self.finder.get_broadcast_irregularity_info(pid)
                if irregularity and irregularity.get('irregularities'):
                    announce = ','.join(irregularity['irregularities'])
                else:
                    announce = f'none(it has pid: {pid})'
            except Exception as e:
                print(f"[getFromSid] announce取得エラー PID={pid}: {e}")
                announce = f'none(it has pid: {pid})'

        # 末尾の種別表記((アニメ)/(TV)/(漫画))はタイトル/略称からも除去する
        title = self._strip_wiki_title_suffix(title_info.get('title') or '')
        short_title = self._strip_wiki_title_suffix(title_info.get('short_title') or title)

        # episode_name: 話数がリスト(範囲/複数話)なら tid から各話サブタイトルを再取得する。
        # count/subtitle の生テキスト(例 "#1～3")のままにせず正確な各話名へ揃える。
        episode_name: Union[str, List[str]] = prog_info.get('subtitle') or ''
        if isinstance(episode_num, list) and tid:
            try:
                subs = self.finder.get_all_subtitles(tid)
                smap = {int(e['count']): e['subtitle'] for e in subs if e['count'].isdigit()}
                names = [smap.get(n, '') for n in episode_num]
                if any(names):
                    episode_name = names
            except Exception as e:
                print(f"[getFromSid] episode_name再取得エラー tid={tid}: {e}")

        info: Dict[str, Any] = {
            'sid-episode_number': episode_num,
            'sid-episode_name':   episode_name,
            'sid-title':          title,
            'sid-short_title':    short_title,
            'sid-furigana':       title_info.get('title_yomi') or '',
            'sid-tid':            tid,
            'sid-shoboi_tid':     tid,
            'sid-shoboi_url':     f'https://cal.syoboi.jp/tid/{tid}' if tid else '',
            'sid-pid':            pid,
            'sid-announce':       announce,
            'sid-wiki_title':     None,
            'sid-wiki_url':       None,
        }

        # wiki は Keywords 由来で HTTP 不要のため常に解決する(fetch_wiki に依らず出力へ自動付与できる)
        wt, wu = self._resolve_wiki(title_info, title)
        info['sid-wiki_title'] = wt
        info['sid-wiki_url'] = wu

        return info

    def _resolve_wiki(self, title_info: Dict[str, Any], fallback_title: str):
        """(wiki_title, wiki_url) を決定的に導く。しょぼい Keywords の wikipedia リンクを
        正とし(HTTPスクレイプ不要=API削減)、無ければ作品タイトルへフォールバックする。
        両パス(getFromSid / getFromTitleAndEpisode)で共通に使い表記を揃える。"""
        kw_page = (title_info or {}).get('wiki_title') or ''
        kw_url = (title_info or {}).get('wiki_url') or ''
        if kw_page:
            return self._wiki_title_from_page(kw_page), kw_url
        return self._strip_wiki_title_suffix(fallback_title or ''), ''
