"""パターンの正規表現と、話数・副題の取り出し"""

import re
from typing import Dict, List, Any, Optional


class _RegexMixin:
    """TextParser の一部（パターンの正規表現と、話数・副題の取り出し）。"""

    def _build_regex_pattern(self, template: str,
                            analyzer: Dict[str, Any]) -> tuple[str, List[str]]:
        """
        正規表現パターンを構築
        
        Args:
            template: パターンテンプレート (例: "アニメ「{$1}」 #{$2}「{$3}」")
            analyzer: アナライザー設定
            
        Returns:
            (正規表現パターン, グループ名リスト)
        """
        # [字] などの放送マークを正規化
        template = self._normalize_brackets(template)
        # {$数字} の位置を特定
        placeholder_pattern = re.compile(r'\{\$(\d+)\}')
        placeholders = placeholder_pattern.findall(template)
        
        # 各プレースホルダーに対する正規表現を決定
        group_patterns = {}
        group_mappings = []
        analyze_configs = analyzer.get('analyze', [])

        # テンプレート内の最後のプレースホルダーを特定
        last_placeholder = placeholders[-1] if placeholders else None

        for placeholder in placeholders:
            group_name = f"g{placeholder}"
            group_mappings.append(group_name)

            # このグループに対する正規表現パターンを決定
            # 最後のプレースホルダーの場合は貪欲マッチ、それ以外は非貪欲マッチ
            is_last = (placeholder == last_placeholder)
            regex_for_group = '(.*)' if is_last else '(.*?)'

            # switch対象のグループの場合、listから候補を取得
            for analyze_config in analyze_configs:
                switch_target = analyze_config.get('switch', '')
                if switch_target == f'{{${placeholder}}}':
                    list_items = analyze_config.get('list', [])
                    candidates = []
                    for list_item in list_items:
                        item_str = list_item.get('str', '')
                        if item_str:
                            candidates.append(re.escape(item_str))

                    # else がある場合は候補制限せず任意文字列にマッチ
                    has_else = bool(analyze_config.get('else'))
                    if candidates and not has_else:
                        # 長い順にソート（貪欲マッチを避ける）
                        candidates.sort(key=len, reverse=True)
                        regex_for_group = f"({'|'.join(candidates)})"
                    break

            # setNum/setSubtitles対象の場合（switchが既にパターンを設定している場合はスキップ）
            if regex_for_group in ('(.*)', '(.*?)'):
                # 直接のanalyzeリストを確認（patternタイプなどswitch/listなしの場合）
                for sub_config in analyze_configs:
                    if 'setSubtitles' in sub_config or 'setNum' in sub_config:
                        str_value = sub_config.get('str', '')
                        if f'{{${placeholder}}}' in str_value:
                            # 最後のプレースホルダーは貪欲マッチ、それ以外は非貪欲マッチ
                            # （非最終位置で貪欲マッチにすると後続の「...」を飲み込んでしまう）
                            regex_for_group = r'([\s\S]*)' if is_last else r'([\s\S]*?)'
                            break

            if regex_for_group in ('(.*)', '(.*?)'):
                # このプレースホルダーが setStr でも使われているか事前チェック
                # setStr が存在する場合は自由形式テキストとして扱い、話数パターンを適用しない
                placeholder_in_setstr = any(
                    f'{{${placeholder}}}' in s.get('str', '')
                    for ac in analyze_configs
                    for li in ac.get('list', [])
                    for s in li.get('analyze', [])
                    if 'setStr' in s or 'addList' in s
                )
                for analyze_config in analyze_configs:
                    list_items = analyze_config.get('list', [])
                    for list_item in list_items:
                        sub_analyze = list_item.get('analyze', [])
                        for sub_config in sub_analyze:
                            if 'setNum' in sub_config:
                                str_value = sub_config.get('str', '')
                                if f'{{${placeholder}}}' in str_value and not placeholder_in_setstr:
                                    num_pattern = r'\d+(?:\.\d+)?'
                                    kanji_pattern = r'(?:[一二三四五六七八九壱弐参肆伍陸漆捌玖]?[十拾][一二三四五六七八九壱弐参肆伍陸漆捌玖]?|[零〇一二三四五六七八九壱弐参肆伍陸漆捌玖])'
                                    english_pattern = r'(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)'
                                    single_num = f"(?:{num_pattern}|{kanji_pattern}|{english_pattern})"
                                    subtitle_suffix = r'(?:「[^」]*」)?'
                                    sharp_pattern = r'[#＃]?'
                                    sep_pattern = r'(?:[,，・/／&＆]|\s*[\-~ー〜～－‐−–—]\s*)'
                                    regex_for_group = f"({sharp_pattern}{single_num}{subtitle_suffix}(?:{sep_pattern}{sharp_pattern}{single_num}{subtitle_suffix})*|全{num_pattern}[話回]?)"
                                    break
                            if 'setSubtitles' in sub_config:
                                str_value = sub_config.get('str', '')
                                if f'{{${placeholder}}}' in str_value:
                                    # サブタイトルリストは改行を含む全文字にマッチ
                                    regex_for_group = r'([\s\S]*)'
                                    break

            group_patterns[placeholder] = regex_for_group
        
        # テンプレートを正規表現に変換
        # まず固定文字列部分をエスケープ
        parts = []
        last_end = 0
        for match in placeholder_pattern.finditer(template):
            # プレースホルダー前の固定文字列
            if match.start() > last_end:
                parts.append(re.escape(template[last_end:match.start()]))
            # プレースホルダーを正規表現に置換
            group_num = match.group(1)
            parts.append(group_patterns.get(group_num, '(.*?)'))
            last_end = match.end()
        
        # 最後の固定文字列
        if last_end < len(template):
            parts.append(re.escape(template[last_end:]))
        
        pattern = ''.join(parts)
        
        return pattern, group_mappings
    
    def _convert_to_subtitles(self, value: str, separator: str = '#') -> List[str]:
        """「01 タイトル#02 タイトル」形式をサブタイトルのリストに変換

        先頭の話数番号（数字 + 区切り文字）を除去して各サブタイトルを返す。

        例:
            "01 WAR STORM#02 GALAXY RUN" → ["WAR STORM", "GALAXY RUN"]
            "1.春の嵐#2.夏の海" → ["春の嵐", "夏の海"]
            "WAR STORM#GALAXY RUN" → ["WAR STORM", "GALAXY RUN"]
            "第５話「新展開！」\\n第６話「解決編」" → ["新展開！", "解決編"]
            "第1話〜名もなき薬・第2話〜手紙" → ["名もなき薬", "手紙"]
        """
        # 第N話形式 (第N話「subtitle」 / 第N話〜subtitle / 最終話〜subtitle)
        dai_wa = self._parse_dai_wa_episodes(value)
        if dai_wa is not None:
            return [ep[1] for ep in dai_wa]

        parts = re.split(r'\n|' + re.escape(separator), value)
        subtitles = []
        for part in parts:
            part = part.strip()
            if not part:
                continue
            # 先頭の話数番号を除去: [＃#] + 数字 + スペース/ピリオド/読点/中点
            cleaned = re.sub(r'^[＃#]?\d+[\s.、・]+', '', part).strip()
            subtitles.append(cleaned if cleaned else part)
        return subtitles

    def _parse_dai_wa_episodes(self, value: str) -> Optional[List[tuple]]:
        """「第N話「subtitle」」や「第N話〜subtitle」形式の複数話文字列を解析する。

        対応形式:
            第５話「新展開！」\\n第６話「解決編」
            第1話〜名もなき薬・第2話〜手紙・第3話〜証人
            第９話～敵の姿・最終話～旅の終わり  (最終話 → 前話+1)

        Returns:
            [(episode_num, subtitle), ...] のリスト、または非対応形式の場合は None
        """
        normalized = self._normalize_digits(value)

        # 第N話 または 最終話 を含まない場合は対象外
        if not re.search(r'第\d+話|最終話', normalized):
            return None

        # \n・ または 第N話/最終話 の直前で分割（区切り文字なし連続にも対応）
        parts = [p.strip() for p in re.split(r'\n|・|(?=第\d+話|最終話)', normalized) if p.strip()]
        if not parts:
            return None

        episodes: list[tuple] = []
        for part in parts:
            # 最終話パターン
            if re.match(r'最終話', part):
                rest = part[len('最終話'):]
                subtitle = self._extract_dai_wa_subtitle(rest)
                episodes.append((None, subtitle))
                continue

            # 第N話パターン
            m = re.match(r'第(\d+)話', part)
            if not m:
                return None  # 期待しない形式が混在 → このパーサーでは処理しない
            num = int(m.group(1))
            rest = part[m.end():]
            subtitle = self._extract_dai_wa_subtitle(rest)
            episodes.append((num, subtitle))

        if not episodes:
            return None

        # 最終話の話数を直前の話数+1で解決する
        result: list[tuple] = []
        last_num = 0
        for num, subtitle in episodes:
            if num is None:
                num = last_num + 1
            last_num = num
            result.append((num, subtitle))

        return result

    @staticmethod
    def _extract_dai_wa_subtitle(rest: str) -> str:
        """第N話・最終話の後に続くサブタイトル部分を抽出する。

        対応形式:
            「subtitle」  → subtitle
            〜subtitle / ～subtitle / -subtitle → subtitle
        """
        rest = rest.strip()
        # 「subtitle」形式
        m = re.match(r'^「([^」]*)」', rest)
        if m:
            return m.group(1).strip()
        # 〜 / ～ / - 区切り形式
        m = re.match(r'^[〜～\-]+(.+)', rest)
        if m:
            return m.group(1).strip()
        return rest

    @staticmethod
    def _normalize_digits(value: str) -> str:
        """全角数字・全角記号を半角に正規化"""
        return value.translate(str.maketrans(
            '０１２３４５６７８９＃',
            '0123456789#'
        ))
