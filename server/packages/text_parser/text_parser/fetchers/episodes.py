"""文章・手元の情報からの話数の取り出し"""

import re
from typing import Dict, List, Any, Union


class _EpisodesMixin:
    """ShoboiInfoFetcher の一部（文章・手元の情報からの話数の取り出し）。"""

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def extract_episodes_from_text(text: str) -> Union[int, List[int], None]:
        """テキスト（Shoboiカウント・サブタイトル・EIT説明文等）から話数（リスト可）を抽出する。

        対応パターン:
        - "13～17", "#13～#17 ..." → [13,14,15,16,17] (範囲)
        - "#3 タイトル / #4 タイトル / ..." → [3,4,5] (複数 # 出現)
        - "#13" → 13 (単一)
        - "第13話" → 13
        """
        if not text:
            return None
        from ..parser.core import TextParser
        text = TextParser._normalize_digits(text)

        # パターン1: 範囲指定（先頭が "#N～M" または "N～M" 形式）
        m = re.match(r'^\s*#?(\d+)\s*[-~ー〜～－‐−–—]\s*#?(\d+)', text)
        if m:
            start, end = int(m.group(1)), int(m.group(2))
            if 0 < start <= end <= start + 200:
                return list(range(start, end + 1)) if start != end else start

        # パターン2: 複数の #N（スラッシュ区切り等）
        hash_nums = [int(hm.group(1)) for hm in re.finditer(r'#(\d+)', text)]
        if len(hash_nums) >= 2:
            return sorted(set(hash_nums))
        if len(hash_nums) == 1:
            return hash_nums[0]

        # パターン3: 第N話（複数 or 単一）
        dai_wa = [int(hm.group(1)) for hm in re.finditer(r'第(\d+)話', text)]
        if len(dai_wa) >= 2:
            return sorted(set(dai_wa))
        if len(dai_wa) == 1:
            return dai_wa[0]

        return None

    @staticmethod
    def find_episode_in_cache(programs_cache: list, start_time: str, time_tolerance_min: int = 10) -> Union[int, List[int], None]:
        """
        一括取得済みの番組リストから start_time に最も近い番組の話数を返す。
        API 呼び出し不要版。

        Args:
            programs_cache: shoboi_api.search_programs_in_range の返値リスト
            start_time: 放送開始時刻 (YYYY-MM-DD HH:MM:SS)
            time_tolerance_min: 時刻の許容誤差（分）
        """
        from .core import ShoboiInfoFetcher   # 分けた後も元と同じくクラス経由で呼ぶ
        from datetime import datetime as _dt

        try:
            target = _dt.strptime(start_time, '%Y-%m-%d %H:%M:%S')
        except (ValueError, TypeError):
            return None

        best_count = None
        best_diff = float('inf')

        for prog in programs_cache:
            prog_start_str = prog.get('start_time', '')
            if not prog_start_str:
                continue
            try:
                prog_start = _dt.strptime(prog_start_str, '%Y-%m-%d %H:%M:%S')
                diff = abs((prog_start - target).total_seconds() / 60)
                if diff <= time_tolerance_min and diff < best_diff:
                    count = str(prog.get('count', ''))
                    episode: Union[int, List[int], None] = None
                    if count and count.isdigit():
                        episode = int(count)
                    elif count:
                        episode = ShoboiInfoFetcher.extract_episodes_from_text(count)
                    if episode is None:
                        episode = ShoboiInfoFetcher.extract_episodes_from_text(prog.get('subtitle', ''))
                    if episode is not None:
                        best_count = episode
                        best_diff = diff
            except (ValueError, TypeError):
                continue

        return best_count

    @staticmethod
    def _strip_wiki_title_suffix(title: str) -> str:
        """タイトル/Wikiページ名の末尾の括弧付き種別表記を除去する。
        (アニメ)/(TV)/(TVアニメ)/(TVシリーズ)/(漫画)/(映画)/(劇場版)/(OVA)/(ドラマ) 等、
        メディア種別語を含む末尾の (…) を落とす。"""
        if not title:
            return title
        title = re.sub(r'\s*\([^)]*(?:アニメ|TV|漫画|映画|劇場版|OVA|ドラマ)[^)]*\)\s*$', '', title)
        return title.rstrip()

    @classmethod
    def _wiki_title_from_page(cls, page: str) -> str:
        """しょぼいカレンダー Keywords 由来の Wikipedia ページ名を表示用タイトルへ決定的に変換する。

        ページ名は URL 形式(アンダースコア=空白、#以降=節アンカー)なので:
        アンカー除去 → '_'→' ' → 種別サフィックス((アニメ)/(TV)/(漫画))除去。
        これにより「作品名_(アニメ)」「作品名#劇場アニメ」いずれも「作品名」に揃う。
        ページ HTML の H1 は別作品名(改名・リダイレクト)を指すことがあるため使わない。"""
        if not page:
            return ''
        name = page.split('#', 1)[0].replace('_', ' ')
        return cls._strip_wiki_title_suffix(name).strip()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _has_episode(self, candidate: Dict[str, Any], ep_num: int) -> bool:
        """候補番組が指定話数を持つか確認する"""
        try:
            subs = self.finder.get_all_subtitles(candidate.get('tid', ''))
            counts = {int(e['count']) for e in subs if e['count'].isdigit()}
            return ep_num in counts
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_episode_from_sid_and_time(self, sid: int, start_time: str, time_tolerance_min: int = 10) -> Union[int, List[int], None]:
        """
        SID と放送日時から話数を取得する

        Args:
            sid: サービスID (例: 23608=MINATO TV, 333=KT-Z)
            start_time: 放送開始時刻 (YYYY-MM-DD HH:MM:SS)
            time_tolerance_min: 時刻の許容誤差（分）

        Returns:
            話数 (int またはリスト)、取得できない場合は None
        """
        ch_id = self.finder.get_chid(sid=sid)
        if not ch_id:
            return None

        prog_info = self.finder.search_program(ch_id, start_time, time_tolerance_min)
        if not prog_info:
            return None

        count = str(prog_info.get('count', ''))
        if count and count.isdigit():
            return int(count)
        if count:
            episode = self.extract_episodes_from_text(count)
            if episode is not None:
                return episode
        return self.extract_episodes_from_text(prog_info.get('subtitle', ''))
