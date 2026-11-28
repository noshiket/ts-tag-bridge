"""CompleteProgramFinder の一部（作品の情報・Wikipedia・放送の変更）。

shoboi_api のモジュール直下の名前（規制の状態・設定・補助）は、テストの差し替えや
規制の状態の更新が効くよう、名前で読み込まずに _sa.名前 で使う時に引く。
"""


from . import shoboi_api as _sa


class _InfoMixin:
    """CompleteProgramFinder の一部（作品の情報・Wikipedia・放送の変更）。"""

    def get_title_info(self, tid: str) -> _sa.Optional[_sa.Dict]:
        """TIDから作品情報を取得(ラン内メモ化)"""
        # 取り直し(再解析)ではメモも使わない。解析器はこのインスタンスを持ち続けるので、
        # ここで返すとサーバーを再起動するまで略称・作品名の修正を拾えない
        if tid in self._title_info_cache and not getattr(_sa._parse_local, 'fresh', False):
            return self._title_info_cache[tid]
        from . import shoboi_store
        if not getattr(_sa._parse_local, 'fresh', False):
            stored = shoboi_store.title(tid)
            if stored:
                self._title_info_cache[tid] = stored['info']
                return stored['info']
        url = f"{self.BASE_URL}/db.php"
        params = {'Command': 'TitleLookup', 'TID': tid}

        result = None
        try:
            response = self.session.get(url, params=params, timeout=10)
            root = _sa.ET.fromstring(response.content)
            title_item = root.find('.//TitleItem')

            if title_item is not None:
                shoboi_store.save_title_items([title_item], self)
                wt, wu = self._extract_wiki_from_keywords(title_item.findtext('Keywords', ''))
                result = {
                    'tid': tid,
                    'title': title_item.findtext('Title', ''),
                    'short_title': title_item.findtext('ShortTitle', ''),
                    'title_yomi': title_item.findtext('TitleYomi', ''),
                    'title_en': title_item.findtext('TitleEN', ''),
                    'first_year': title_item.findtext('FirstYear', ''),
                    'first_month': title_item.findtext('FirstMonth', ''),
                    'wiki_title': wt,
                    'wiki_url': wu,
                }
        except _sa.SyobocalRateLimitError:
            raise  # レート制限は握りつぶさず上位へ(parser_error誤帰属を防ぐ)
        except Exception as e:
            print(f"作品情報取得エラー: {e}")

        self._title_info_cache[tid] = result
        return result
    
    def _extract_wiki_from_keywords(self, keywords: str):
        """Keywords フィールドから Wikipedia ページ名と URL を返す"""
        from urllib.parse import unquote
        for kw in keywords.split(','):
            kw = kw.strip()
            if kw.startswith('wikipedia:'):
                page = kw[len('wikipedia:'):]
                wiki_title = unquote(page)
                wiki_url = f'https://ja.wikipedia.org/wiki/{page}'
                return wiki_title, wiki_url
        return '', ''

    def get_wikipedia_url(self, tid: str) -> str:
        """TIDからWikipedia URLのみ取得（TitleLookup の Keywords 欄から）。

        以前は作品ページ(/tid/<TID>)の HTML からリンクを探していたが、しょぼいカレンダーの
        bot 利用規約が HTML のスクレイピングを禁じているので API だけにする。
        """
        try:
            info = self.get_title_info(tid)
        except _sa.SyobocalRateLimitError:
            return ''
        return (info or {}).get('wiki_url') or ''

    def get_wikipedia_title(self, url: str) -> str:
        """Wikipedia URLからページタイトルを取得（Wikipedia1リクエスト）"""
        try:
            response = self.session.get(url, timeout=8, allow_redirects=True)
            response.raise_for_status()
            soup = _sa.BeautifulSoup(response.text, 'html.parser')
            h1 = soup.find('h1', class_='firstHeading')
            if h1:
                return h1.text.strip()
            title_tag = soup.find('title')
            if title_tag:
                return _sa.re.sub(r'\s*[-–—]\s*Wikipedia.*$', '', title_tag.text).strip()
        except Exception:
            pass
        return ''

    def get_wikipedia_info(self, tid: str, pid: str = None) -> _sa.Dict:
        """しょぼいカレンダーからWikipedia情報を取得"""
        
        result = {
            'wikipedia_url': None,
            'wikipedia_title': None,
            'wikipedia_final_url': None,
            'is_redirect': False,
        }
        
        try:
            # Wikipedia のページ名は TitleLookup の Keywords 欄から取る（放送回ページの HTML を
            # 読むのは bot 利用規約が禁じるスクレイピングなのでやめた）
            wikipedia_link = self.get_wikipedia_url(tid)
            if not wikipedia_link:
                return result
            
            result['wikipedia_url'] = wikipedia_link
            
            # Wikipediaのページを取得（リダイレクト追跡）
            wiki_response = self.session.get(wikipedia_link, timeout=10, allow_redirects=True)
            wiki_response.raise_for_status()
            
            final_url = wiki_response.url
            result['wikipedia_final_url'] = final_url
            
            if final_url != wikipedia_link:
                result['is_redirect'] = True
            
            # タイトルを取得
            wiki_soup = _sa.BeautifulSoup(wiki_response.text, 'html.parser')
            
            # h1要素から取得（最も正確）
            h1_tag = wiki_soup.find('h1', class_='firstHeading')
            if h1_tag:
                result['wikipedia_title'] = h1_tag.text.strip()
            else:
                # <title>タグから取得
                title_tag = wiki_soup.find('title')
                if title_tag:
                    full_title = title_tag.text
                    page_title = _sa.re.sub(r'\s*[-–—]\s*Wikipedia.*$', '', full_title)
                    result['wikipedia_title'] = page_title
            
        except Exception as e:
            print(f"Wikipedia情報取得エラー: {e}")
        
        return result
    
    def get_complete_info(self,
                         sid: int = None,
                         service_name: str = None,
                         start_time: str = None,
                         time_tolerance_min: int = 10) -> _sa.Optional[_sa.Dict]:
        """
        放送時間とチャンネルから完全な情報を取得
        
        Args:
            sid: サービスID
            service_name: サービス名
            start_time: 開始時刻 (YYYY-MM-DD HH:MM:SS)
            time_tolerance_min: 時刻の許容誤差（分）
        
        Returns:
            完全な番組情報の辞書
        """
        # ChIDを取得
        ch_id = self.get_chid(sid, service_name)
        
        if not ch_id:
            print(f"エラー: ChIDが特定できません (sid={sid}, service_name={service_name})")
            return None
        
        print(f"検索: ChID={ch_id}, 開始時刻={start_time}")
        
        # 番組を検索
        prog_info = self.search_program(ch_id, start_time, time_tolerance_min)
        
        if not prog_info:
            print("番組が見つかりませんでした")
            return None
        
        print(f"  → 番組を発見 (PID: {prog_info['pid']}, 時刻差: {prog_info['time_diff_min']:.1f}分)")
        
        # 作品情報を取得
        title_info = self.get_title_info(prog_info['tid'])
        
        if not title_info:
            print("作品情報の取得に失敗")
            return None
        
        print(f"  → 作品: {title_info['title']}")
        
        # サブタイトルが空の場合、サブタイトルテーブルから取得を試みる
        if not prog_info['subtitle'] and prog_info['count']:
            print(f"  → サブタイトルテーブルから第{prog_info['count']}話のサブタイトルを取得中...")
            subtitle = self.get_subtitle_from_table(prog_info['tid'], prog_info['count'])
            if subtitle:
                prog_info['subtitle'] = subtitle
                print(f"     サブタイトル: {subtitle}")
        
        # Wikipedia情報を取得
        print("  → Wikipedia情報を取得中...")
        wiki_info = self.get_wikipedia_info(prog_info['tid'], prog_info['pid'])
        
        # 統合
        complete_info = {
            **prog_info,
            **title_info,
            **wiki_info,
            'ch_id': ch_id,
            'syobocal_url': f"https://cal.syoboi.jp/tid/{prog_info['tid']}/time#{prog_info['pid']}",
        }
        
        return complete_info
    
    def format_result(self, info: _sa.Dict) -> str:
        """結果を整形して表示"""
        if not info:
            return "情報が取得できませんでした"
        
        lines = []
        lines.append("=" * 80)
        lines.append("【番組情報】")
        lines.append("=" * 80)
        lines.append(f"作品タイトル: {info['title']}")
        lines.append(f"略称: {info['short_title']}")
        
        if info['count']:
            episode_info = f"第{info['count']}話"
            if info['subtitle']:
                episode_info += f" 「{info['subtitle']}」"
            lines.append(f"話数: {episode_info}")
        else:
            lines.append("話数: 情報なし")
        
        lines.append(f"放送時間: {info['start_time']} ～ {info['end_time']}")
        lines.append("")
        lines.append("【しょぼいカレンダー】")
        lines.append(f"TID: {info['tid']}")
        lines.append(f"PID: {info['pid']}")
        lines.append(f"URL: {info['syobocal_url']}")
        lines.append("")
        lines.append("【Wikipedia】")
        if info['wikipedia_url']:
            lines.append(f"元のURL: {info['wikipedia_url']}")
            if info['is_redirect']:
                lines.append(f"リダイレクト先: {info['wikipedia_final_url']}")
            lines.append(f"ページタイトル: {info['wikipedia_title']}")
        else:
            lines.append("Wikipediaリンクなし")
        lines.append("=" * 80)
        
        return "\n".join(lines)
    
    def get_broadcast_irregularity_info(self, pid: str) -> _sa.Optional[_sa.Dict]:
        """
        PIDから放送の異常情報（テロップ、繰り下げなど）を取得
        
        Args:
            pid: プログラムID
        
        Returns:
            放送異常情報 {
                'has_telop': bool,
                'telop_type': str,
                'has_delay': bool,
                'delay_reason': str,
                'irregularities': list,  # すべての異常情報のリスト
                'prog_comment': str
            }
        """
        from . import shoboi_store
        if not getattr(_sa._parse_local, 'fresh', False):
            stored = shoboi_store.program_by_pid(pid)
            if stored:
                return self._irregularity(stored['prog_comment'], stored['flag'], stored['warn'])
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'ProgLookup',
            'PID': pid
        }
        
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()
            root = _sa.ET.fromstring(response.content)
            
            prog = root.find('.//ProgItem')
            if prog is None:
                return None
            shoboi_store.save_prog_items([prog])
            
            # ProgCommentフィールドから情報を取得
            prog_comment = prog.find('ProgComment')
            prog_comment_text = (prog_comment.text or '') if prog_comment is not None else ''
            
            flag = prog.find('Flag')
            flag_value = flag.text if flag is not None else ''
            
            warn = prog.find('Warn')
            warn_value = warn.text if warn is not None else ''
            return self._irregularity(prog_comment_text, flag_value, warn_value)
        except Exception as e:
            print(f"放送異常情報取得エラー: {e}")
            return None

    @staticmethod
    def _irregularity(prog_comment_text: str, flag_value: str, warn_value: str) -> _sa.Dict:
        """ProgComment などから放送の異常情報を読み取る。"""
        # 各種異常の判定
        irregularities = []
        
        # テロップ判定
        has_telop = 'テロップあり' in prog_comment_text
        telop_type = None
        if has_telop:
            if '地震情報' in prog_comment_text or '地震' in prog_comment_text:
                telop_type = '地震情報'
                irregularities.append('地震情報テロップ')
            elif '津波情報' in prog_comment_text or '津波' in prog_comment_text:
                telop_type = '津波情報'
                irregularities.append('津波情報テロップ')
            elif '気象情報' in prog_comment_text or '気象' in prog_comment_text:
                telop_type = '気象情報'
                irregularities.append('気象情報テロップ')
            else:
                telop_type = 'その他'
                irregularities.append('テロップ')
        
        # 繰り下げ判定
        has_delay = '繰り下げ' in prog_comment_text or '繰下げ' in prog_comment_text
        delay_reason = None
        if has_delay:
            if '地震' in prog_comment_text:
                delay_reason = '地震ニュース'
                irregularities.append('地震ニュースによる繰り下げ')
            elif '臨時ニュース' in prog_comment_text or 'ニュース挿入' in prog_comment_text:
                delay_reason = '臨時ニュース'
                irregularities.append('臨時ニュースによる繰り下げ')
            else:
                delay_reason = 'その他'
                irregularities.append('繰り下げ')
        
        # その他の情報
        if '一挙' in prog_comment_text or '一挙放送' in prog_comment_text:
            irregularities.append('一挙放送')
        
        if '再放送' in prog_comment_text:
            irregularities.append('再放送')
        
        if '放送日移動' in prog_comment_text:
            irregularities.append('放送日移動')
        
        return {
            'has_telop': has_telop,
            'telop_type': telop_type,
            'has_delay': has_delay,
            'delay_reason': delay_reason,
            'irregularities': irregularities,
            'flag': flag_value,
            'warn': warn_value,
            'prog_comment': prog_comment_text
        }
