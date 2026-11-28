"""CompleteProgramFinder の一部（作品名での検索と、サブタイトル・話数の取り出し）。

shoboi_api のモジュール直下の名前（規制の状態・設定・補助）は、テストの差し替えや
規制の状態の更新が効くよう、名前で読み込まずに _sa.名前 で使う時に引く。
"""


from . import shoboi_api as _sa


class _TitlesMixin:
    """CompleteProgramFinder の一部（作品名での検索と、サブタイトル・話数の取り出し）。"""

    def search_title_by_keyword(self, keyword: str) -> _sa.List[_sa.Dict]:
        """作品名で作品を探す（一致の度合いの高い順、50件まで）。

        しょぼいカレンダーの API は作品名での検索を受け付けない（TitleLookup の Title は
        「対応していません」の 400）ので、番組表の取り直しで手元に置いた全作品の名前から探す。
        問い合わせはしない。略称・読みは作品情報を覚えている作品だけ使う。
        """
        import unicodedata
        from . import shoboi_store

        def normalize_text(text: str) -> str:
            """全角→半角、カタカナ→ひらがな、空白と一部の記号を除く"""
            if not text:
                return ""
            text = unicodedata.normalize('NFKC', text)
            text = ''.join([chr(ord(c) - 96) if 'ァ' <= c <= 'ン' else c for c in text])
            text = ''.join([c for c in text if not c.isspace() and c not in '・＆&～~'])
            return text.lower()

        names = shoboi_store.title_names()
        if not names:
            print("[search_title_by_keyword] 作品名の一覧がまだありません（番組表の取り直しで取ります）",
                  flush=True)
            return []
        keyword_normalized = normalize_text(keyword)
        keyword_lower = keyword.lower()
        candidates = []
        for tid, title, info in names:
            info = info or {}
            short_title = info.get('short_title', '')
            title_yomi = info.get('title_yomi', '')
            score = 0
            matched = False
            # 1. 完全一致
            if title == keyword or short_title == keyword:
                score += 1000
                matched = True
            # 2. 正規化して一致
            title_normalized = normalize_text(title)
            short_title_normalized = normalize_text(short_title)
            if keyword_normalized in (title_normalized, short_title_normalized):
                score += 500
                matched = True
            # 3. 前方一致・部分一致
            title_lower = title.lower()
            short_title_lower = short_title.lower()
            if title_lower.startswith(keyword_lower) or (short_title and short_title_lower.startswith(keyword_lower)):
                score += 200
                matched = True
            elif keyword_lower in title_lower or (short_title and keyword_lower in short_title_lower):
                score += 100
                matched = True
            if not matched and keyword_normalized and (keyword_normalized in title_normalized
                                                       or keyword_normalized in short_title_normalized):
                score += 50
                matched = True
            # 4. 読み
            if not matched and title_yomi and keyword in title_yomi:
                score += 30
                matched = True
            if not matched:
                continue
            try:
                score += int(tid) * 0.001       # 新しい登録を少し優先
            except ValueError:
                pass
            candidates.append((score, {
                'tid': tid, 'title': title, 'short_title': short_title, 'title_yomi': title_yomi,
                'title_en': info.get('title_en', ''), 'first_year': info.get('first_year', ''),
                'first_month': info.get('first_month', '')}))
        candidates.sort(key=lambda x: x[0], reverse=True)
        results = [c for _, c in candidates[:50]]
        # 作品情報をまだ持っていない作品は TID でまとめて1回取り、そのまま返す（手元にも保存）
        missing = [c['tid'] for c in results if not c['first_year'] and not c['title_yomi']]
        if missing:
            try:
                items = shoboi_store._lookup(self, {'Command': 'TitleLookup', 'TID': ','.join(missing)}
                                             ).findall('.//TitleItem')
                shoboi_store.save_title_items(items, self)
                got = {it.findtext('TID', ''): shoboi_store.title_info_from_item(it, self) for it in items}
                results = [{**c, **got[c['tid']]} if c['tid'] in got else c for c in results]
            except Exception as e:
                print(f"[search_title_by_keyword] 作品情報を取れませんでした（作品名だけ返します）: {e}",
                      flush=True)
        return results

    def get_subtitle_from_table(self, tid: str, count: str) -> _sa.Optional[str]:
        """
        TitleLookupのSubTitlesフィールドから話数のサブタイトルを取得
        
        Args:
            tid: タイトルID
            count: 話数
        
        Returns:
            サブタイトル
        """
        if not count:
            return None
        from . import shoboi_store
        if str(count).isdigit() and not getattr(_sa._parse_local, 'fresh', False):
            stored = shoboi_store.title(tid)
            if stored:
                for e in stored['subtitles']:
                    if int(e['count']) == int(count):
                        return e['subtitle']
                return None
        
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'TitleLookup',
            'TID': tid
        }
        
        try:
            response = self.session.get(url, params=params, timeout=10)

            # レスポンスが空または不正な場合はスキップ
            if not response.content or len(response.content) == 0:
                return None

            # XMLパースを試みる
            try:
                root = _sa.ET.fromstring(response.content)
            except _sa.ET.ParseError as e:
                # XMLパースエラーの場合は詳細を表示せず静かに失敗
                # print(f"[get_subtitle_from_table] XML parse error for TID={tid}, count={count}")
                return None

            title_item = root.find('.//TitleItem')

            if title_item is not None:
                subtitles_field = title_item.findtext('SubTitles', '')

                if subtitles_field:
                    # デバッグ: 特定のTIDでデータ形式を確認
                    if tid in ["7532"] and count in ["1", "2", "11", "12", "13"]:
                        print(f"[DEBUG] TID={tid}, count={count}")
                        print(f"[DEBUG] SubTitles field: {subtitles_field[:800]}")

                    # "*16*エピソード名" の形式から抽出
                    import re

                    if count.isdigit():
                        # 複数の0埋めパターンを試す
                        for padding in [0, 2, 3, 4]:  # 無埋め、2桁、3桁、4桁
                            if padding == 0:
                                padded_count = count
                            else:
                                padded_count = count.zfill(padding)

                            pattern = rf'\*{padded_count}\*([^\*\n]+)'
                            matches = re.findall(pattern, subtitles_field)

                            if matches:
                                return matches[0].strip()
                    else:
                        # 数字以外の場合はそのまま試す
                        pattern = rf'\*{count}\*([^\*\n]+)'
                        matches = re.findall(pattern, subtitles_field)

                        if matches:
                            return matches[0].strip()
        except Exception as e:
            # ネットワークエラーなどの場合は静かに失敗
            # print(f"[get_subtitle_from_table] Error for TID={tid}, count={count}: {e}")
            pass
        
        return None
    def get_all_subtitles(self, tid: str) -> _sa.List[_sa.Dict]:
        """
        TitleLookupのSubTitlesフィールドから全エピソードのサブタイトルを取得

        Args:
            tid: タイトルID

        Returns:
            エピソード情報のリスト [{'count': '1', 'subtitle': 'サブタイトル'}, ...]
        """
        if tid in self._subtitles_cache:
            return self._subtitles_cache[tid]
        # プロセス内で共有するキャッシュ。text_parser は解析のたびに
        # CompleteProgramFinder() を作り直すため、インスタンス側のキャッシュだけだと
        # 毎回通信になる。同じ解析を繰り返すたびに結果が変わる（通信が失敗した回だけ
        # サブタイトルが空になる）原因がこれ。
        hit = _sa._shared_subtitles_get(tid)
        if hit is not None:
            self._subtitles_cache[tid] = hit
            return hit
        # 覚えた作品は番組表の取り直しのたびに変わったかを確かめているので、それを使う
        from . import shoboi_store
        if not getattr(_sa._parse_local, 'fresh', False):
            stored = shoboi_store.title(tid)
            if stored:
                self._title_info_cache[tid] = stored['info']
                self._subtitles_cache[tid] = stored['subtitles']
                return stored['subtitles']
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'TitleLookup',
            'TID': tid
        }

        episodes: _sa.List[_sa.Dict] = []
        try:
            # 同じ TitleLookup でも、全サブタイトルは話数が増えるので覚えた分を使わない
            with _sa.fresh():
                response = self.session.get(url, params=params, timeout=10)
            root = _sa.ET.fromstring(response.content)
            title_item = root.find('.//TitleItem')

            if title_item is not None:
                shoboi_store.save_title_items([title_item], self)
                # 同じ応答に作品情報も入っているので、get_title_info が同じ TitleLookup を
                # もう一度送らずに済むよう覚えておく
                wt, wu = self._extract_wiki_from_keywords(title_item.findtext('Keywords', ''))
                self._title_info_cache[tid] = {
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
                subtitles_field = title_item.findtext('SubTitles', '')

                if subtitles_field:
                    # "*話数*サブタイトル" の形式から全件抽出
                    for match in _sa.re.finditer(r'\*(\d+)\*([^\*\n]+)', subtitles_field):
                        episodes.append({
                            'count': match.group(1),
                            'subtitle': match.group(2).strip()
                        })
        except _sa.SyobocalRateLimitError:
            raise
        except Exception as e:
            # 取れなかった時は覚えない。ここで空を焼き付けると、一度の通信失敗が
            # そのあとずっと「サブタイトル無し」として残る
            print(f"全サブタイトル取得エラー: {e}")
            return list(self._subtitles_cache.get(tid) or _sa._shared_subtitles_get(tid) or [])

        self._subtitles_cache[tid] = episodes
        _sa._shared_subtitles_put(tid, episodes)
        return episodes

    def get_episode_name_by_tid_count(self, tid: str, count: str) -> _sa.Optional[_sa.Dict]:
        """
        TIDと話数からエピソード情報を取得
        
        Args:
            tid: タイトルID
            count: 話数
        
        Returns:
            エピソード情報の辞書
        """
        # 作品情報を取得
        title_info = self.get_title_info(tid)
        
        if not title_info:
            return None
        
        # エピソード名を取得
        subtitle = self.get_subtitle_from_table(tid, count)
        
        return {
            'tid': tid,
            'count': count,
            'title': title_info['title'],
            'short_title': title_info['short_title'],
            'episode_name': subtitle,
        }
    
    def get_episode_name_by_pid(self, pid: str) -> _sa.Optional[_sa.Dict]:
        """
        PIDからエピソード情報を取得
        
        Args:
            pid: 番組ID
        
        Returns:
            エピソード情報の辞書
        """
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'ProgLookup',
            'PID': pid,
            'JOIN': 'SubTitles'
        }
        
        try:
            response = self.session.get(url, params=params, timeout=10)
            root = _sa.ET.fromstring(response.content)
            prog_item = root.find('.//ProgItem')
            
            if prog_item is None:
                return None
            
            tid = prog_item.findtext('TID', '')
            count = prog_item.findtext('Count', '')
            subtitle = prog_item.findtext('SubTitle', '')
            st_subtitle = prog_item.findtext('STSubTitle', '')
            
            # 作品情報を取得
            title_info = self.get_title_info(tid)
            
            if not title_info:
                return None
            
            # STSubTitleを優先
            final_subtitle = st_subtitle if st_subtitle else subtitle
            
            # それでも空なら再取得
            if not final_subtitle and count:
                final_subtitle = self.get_subtitle_from_table(tid, count)
            
            return {
                'pid': pid,
                'tid': tid,
                'count': count,
                'title': title_info['title'],
                'short_title': title_info['short_title'],
                'episode_name': final_subtitle,
                'start_time': prog_item.findtext('StTime', ''),
                'end_time': prog_item.findtext('EdTime', ''),
            }
            
        except Exception as e:
            print(f"PIDから情報取得エラー: {e}")
            return None
