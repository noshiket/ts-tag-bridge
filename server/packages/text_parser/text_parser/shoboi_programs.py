"""CompleteProgramFinder の一部（放送（番組表）の検索）。

shoboi_api のモジュール直下の名前（規制の状態・設定・補助）は、テストの差し替えや
規制の状態の更新が効くよう、名前で読み込まずに _sa.名前 で使う時に引く。
"""


from . import shoboi_api as _sa


class _ProgramsMixin:
    """CompleteProgramFinder の一部（放送（番組表）の検索）。"""

    
    def search_program(self, ch_id: str, start_time: str, time_tolerance_min: int = 10) -> _sa.Optional[_sa.Dict]:
        """
        チャンネルIDと開始時刻から番組を検索
        
        Args:
            ch_id: チャンネルID
            start_time: 開始時刻 (YYYY-MM-DD HH:MM:SS)
            time_tolerance_min: 時刻の許容誤差（分）
        
        Returns:
            番組情報の辞書
        """
        # EDCB由来のeit_start_timeは+09:00付きタイムゾーンを持つことがあり、旧来の
        # 'T'→スペース置換だけでは strptime が失敗して番組検索自体が丸ごとスキップされていた
        # （getFromSid系フィールドが再解析時に空になる不具合の原因）。まず fromisoformat で
        # タイムゾーン付き/無し双方をパースし、tzinfoを落としてnaiveにする
        # （このメソッド内は常にJST naiveとして扱う前提のため）。
        try:
            target_dt = _sa.datetime.fromisoformat(start_time).replace(tzinfo=None)
        except ValueError:
            # ISO 8601 の T セパレータ（EDCB由来）をスペースに正規化してからパース
            start_time_norm = start_time.replace('T', ' ').split('.')[0]
            try:
                target_dt = _sa.datetime.strptime(start_time_norm, '%Y-%m-%d %H:%M:%S')
            except ValueError:
                target_dt = _sa.datetime.strptime(start_time_norm, '%Y-%m-%d %H:%M')
        
        # まとめて取った番組表で答えられれば問い合わせない（画面からの取り直しは除く）
        if not getattr(_sa._parse_local, 'fresh', False):
            from . import shoboi_store
            covered, prog = shoboi_store.program_at(ch_id, target_dt, time_tolerance_min)
            if covered:
                return prog

        # 前日から翌日まで検索
        start_date = (target_dt - _sa.timedelta(days=1)).strftime('%Y%m%d')
        end_date = (target_dt + _sa.timedelta(days=1)).strftime('%Y%m%d')
        
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'ProgLookup',
            'ChID': ch_id,
            'Range': f"{start_date}_000000-{end_date}_235959",
            'JOIN': 'SubTitles'  # サブタイトルテーブルと結合
        }
        
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()

            root = _sa.ET.fromstring(response.content)
            from . import shoboi_store
            shoboi_store.save_prog_items(root.findall('.//ProgItem'))

            # 許容範囲内で時刻差が最小の番組を探す
            best = None
            best_diff = float('inf')
            for prog_item in root.findall('.//ProgItem'):
                st_time_str = prog_item.findtext('StTime', '')

                if not st_time_str:
                    continue

                try:
                    prog_start = _sa.datetime.strptime(st_time_str, '%Y-%m-%d %H:%M:%S')
                    time_diff = abs((prog_start - target_dt).total_seconds() / 60)

                    if time_diff <= time_tolerance_min and time_diff < best_diff:
                        subtitle = prog_item.findtext('SubTitle', '')
                        st_subtitle = prog_item.findtext('STSubTitle', '')  # JOIN結果

                        # STSubTitleが取得できていればそれを優先
                        final_subtitle = st_subtitle if st_subtitle else subtitle

                        best_diff = time_diff
                        best = {
                            'pid': prog_item.findtext('PID', ''),
                            'tid': prog_item.findtext('TID', ''),
                            'start_time': st_time_str,
                            'end_time': prog_item.findtext('EdTime', ''),
                            'count': prog_item.findtext('Count', ''),
                            'subtitle': final_subtitle,
                            'time_diff_min': time_diff,
                        }
                except ValueError:
                    continue

            return best
            
        except Exception as e:
            print(f"番組検索エラー: {e}")
            return None
    
    def search_programs_in_range(self, ch_id: str, start_date: str, end_date: str) -> _sa.List[_sa.Dict]:
        """
        指定期間の全番組を一括取得する（getEpisodeFromSidの一括プリフェッチ用）

        Args:
            ch_id: チャンネルID
            start_date: 開始日 (YYYYMMDD)
            end_date: 終了日 (YYYYMMDD)

        Returns:
            番組情報リスト（各要素は search_program の返値と同形式）
        """
        url = f"{self.BASE_URL}/db.php"
        params = {
            'Command': 'ProgLookup',
            'ChID': ch_id,
            'Range': f"{start_date}_000000-{end_date}_235959",
            'JOIN': 'SubTitles'
        }

        try:
            response = self.session.get(url, params=params, timeout=15)
            response.raise_for_status()
            root = _sa.ET.fromstring(response.content)

            programs = []
            for prog_item in root.findall('.//ProgItem'):
                st_time_str = prog_item.findtext('StTime', '')
                subtitle = prog_item.findtext('STSubTitle', '') or prog_item.findtext('SubTitle', '')
                programs.append({
                    'pid': prog_item.findtext('PID', ''),
                    'tid': prog_item.findtext('TID', ''),
                    'start_time': st_time_str,
                    'end_time': prog_item.findtext('EdTime', ''),
                    'count': prog_item.findtext('Count', ''),
                    'subtitle': subtitle,
                })
            return programs

        except Exception as e:
            print(f"番組一括取得エラー: {e}")
            return []

    def search_programs_by_eit(self, sid: int, start_time: _sa.datetime,
                               search_range_minutes: int = 180) -> dict:
        """SID と開始時刻から syobocal_programs 形式の番組リストを返す。

        logic.py の analyze_task から呼ばれ、旧 syobocal.search_programs_by_eit() の置き換え。
        Returns: {'success': bool, 'programs': [...], 'error': str}
        """
        ch_id = self.SID_TO_CHID.get(sid)
        if ch_id is None:
            return {'success': False, 'programs': [],
                    'error': f"SID {sid} に対応する ChID が未設定です"}

        start_date = (start_time - _sa.timedelta(days=1)).strftime('%Y%m%d')
        end_date = (start_time + _sa.timedelta(minutes=search_range_minutes)).strftime('%Y%m%d')
        raw_progs = self.search_programs_in_range(ch_id, start_date, end_date)

        # 検索範囲内の番組に絞り込む
        cutoff = start_time + _sa.timedelta(minutes=search_range_minutes)
        filtered = [p for p in raw_progs if p.get('start_time') and
                    start_time - _sa.timedelta(days=1) <=
                    _sa.datetime.strptime(p['start_time'], '%Y-%m-%d %H:%M:%S') <= cutoff]

        # ユニーク TID を一括 TitleLookup（1リクエスト）
        unique_tids = list({p.get('tid', '') for p in filtered if p.get('tid')})
        tid_cache: dict = {}
        if unique_tids:
            tl_url = f"{self.BASE_URL}/db.php"
            tl_params = {'Command': 'TitleLookup', 'TID': ','.join(unique_tids)}
            try:
                tl_resp = self.session.get(tl_url, params=tl_params, timeout=10)
                tl_resp.raise_for_status()
                tl_root = _sa.ET.fromstring(tl_resp.content)
                for ti in tl_root.findall('.//TitleItem'):
                    t = ti.findtext('TID', '')
                    wt, wu = self._extract_wiki_from_keywords(ti.findtext('Keywords', ''))
                    tid_cache[t] = {
                        'title':       ti.findtext('Title', ''),
                        'short_title': ti.findtext('ShortTitle', ''),
                        'title_yomi':  ti.findtext('TitleYomi', ''),
                        'title_en':    ti.findtext('TitleEN', ''),
                        'wiki_title':  wt,
                        'wiki_url':    wu,
                    }
            except Exception:
                pass

        programs = []
        for p in filtered:
            tid = p.get('tid', '')
            count = p.get('count') or None
            subtitle = p.get('subtitle', '')
            info = tid_cache.get(tid, {})
            programs.append({
                'pid':        p.get('pid', ''),
                'tid':        tid,
                'title':      info.get('title', ''),
                'short_title':info.get('short_title', ''),
                'title_yomi': info.get('title_yomi', ''),
                'title_en':   info.get('title_en', ''),
                'wiki_title': info.get('wiki_title', ''),
                'wiki_url':   info.get('wiki_url', ''),
                'subtitle':   subtitle,
                'start_time': p.get('start_time'),
                'end_time':   p.get('end_time'),
                'count':      int(count) if count and str(count).isdigit() else None,
                'episode_str':_sa.format_episode_string(count, subtitle),
            })

        return {'success': True, 'programs': programs}
