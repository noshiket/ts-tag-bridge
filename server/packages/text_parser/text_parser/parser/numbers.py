"""数字・漢数字・範囲の変換"""

import re
from typing import List, Optional, Union


class _NumbersMixin:
    """TextParser の一部（数字・漢数字・範囲の変換）。"""

    def _convert_to_number(self, value: str) -> Union[int, List[int]]:
        """文字列を数値またはリストに変換

        複数話パターンの場合はリストを返す：
        - 全話: 全13話 → [1,2,3,...,13]
        - 範囲指定: #16-#20, 16-20, 16~20, 16〜20, 16-#20 → [16,17,18,19,20]
        - カンマ区切り: 1,2,3, #1,#2,#3 → [1,2,3]
        - 中点区切り: 1・2・3, #1・#2 → [1,2,3]
        - スラッシュ区切り: 1/2/3 → [1,2,3]
        - アンパサンド区切り: 25&26, 25&＃26, ２５＆＃２６ → [25,26]
        - 第N話形式: 第5話「subtitle」\\n第6話「subtitle」 → [5,6]

        単一の数値の場合はintを返す
        """
        # 全角数字・全角記号を半角に正規化
        value = self._normalize_digits(value)

        # 第N話形式の複数話パターン (第N話「subtitle」 / 第N話〜subtitle / 最終話〜subtitle)
        dai_wa = self._parse_dai_wa_episodes(value)
        if dai_wa is not None:
            nums = [ep[0] for ep in dai_wa]
            return nums if len(nums) > 1 else nums[0]

        # パターン: 改行区切りの番号付きリスト（例: #1 タイトル\n#2 タイトル）
        if '\n' in value:
            lines = [line.strip() for line in value.split('\n') if line.strip()]
            numbers = []
            for line in lines:
                m = re.match(r'^#?(\d+)', line)
                if m:
                    numbers.append(int(m.group(1)))
            if len(numbers) == len(lines) and numbers:
                return numbers if len(numbers) > 1 else numbers[0]

        # パターン0: 全〇話/全〇回パターン
        all_match = re.match(r'^全(\d+)[話回]?$', value)
        if all_match:
            total = int(all_match.group(1))
            return list(range(1, total + 1))

        # 先頭の#（半角・全角）を除去
        value = value.lstrip('#＃')

        # パターン1: 範囲指定（様々なダッシュ文字に対応）
        range_match = re.match(r'^(.+?)[\-~ー〜～－‐−–—](.+)$', value)
        if range_match:
            start_str = range_match.group(1).strip().lstrip('#＃')
            end_str = range_match.group(2).strip().lstrip('#＃')

            start_num = self._convert_single_number_float(start_str)
            end_num = self._convert_single_number_float(end_str)

            if start_num is not None and end_num is not None and start_num <= end_num:
                result = self._expand_range(start_num, end_num)
                return result if len(result) > 1 else result[0]

        # パターン2: カンマ区切り（,, ，）
        if re.search(r'[,，]', value):
            parts = re.split(r'[,，]\s*[#＃]?', value)
            numbers = []
            for part in parts:
                num = self._convert_single_number(part.strip())
                if num is not None:
                    numbers.append(num)
            if len(numbers) > 1:
                return numbers

        # パターン3: 中点区切り（・）— 各パーツは単一値または範囲
        if '・' in value:
            parts = re.split(r'・\s*', value)
            numbers: List[Union[int, float]] = []
            for part in parts:
                numbers.extend(self._convert_segment_to_list(part.strip()))
            if len(numbers) > 1:
                return numbers

        # パターン4: スラッシュ区切り（/, ／）
        if re.search(r'[/／]', value):
            parts = re.split(r'[/／]\s*[#＃]?', value)
            numbers = []
            for part in parts:
                num = self._convert_single_number(part.strip())
                if num is not None:
                    numbers.append(num)
            if len(numbers) > 1:
                return numbers

        # パターン5: アンパサンド区切り（&, ＆）
        if re.search(r'[&＆]', value):
            parts = re.split(r'[&＆]\s*[#＃]?', value)
            numbers = []
            for part in parts:
                num = self._convert_single_number(part.strip())
                if num is not None:
                    numbers.append(num)
            if len(numbers) > 1:
                return numbers

        # 単一の数値として変換
        result = self._convert_single_number(value)
        return result if result is not None else 0

    def _convert_single_number_float(self, value: str) -> Optional[Union[int, float]]:
        """単一の文字列を整数または小数に変換（setNum の範囲・セグメント処理用）"""
        value = self._normalize_digits(value.strip()).lstrip('#')
        value = re.sub(r'「[^」]*」', '', value).strip()
        if value.isdigit():
            return int(value)
        try:
            f = float(value)
            return int(f) if f == int(f) else f
        except ValueError:
            pass
        return self._convert_single_number(value)

    def _expand_range(self, start: Union[int, float], end: Union[int, float]) -> List[Union[int, float]]:
        """start〜end の数値リストを生成。小数スタートは最初の要素として含める"""
        result: List[Union[int, float]] = []
        if isinstance(start, float) and start != int(start):
            result.append(start)
            next_int = int(start) + 1
        else:
            next_int = int(start)
        result.extend(range(next_int, int(end) + 1))
        # 終端が小数の場合は最後の要素として含める（例: 01-#12.5 → ...,12,12.5）
        if isinstance(end, float) and end != int(end):
            result.append(end)
        return result

    def _convert_segment_to_list(self, seg: str) -> List[Union[int, float]]:
        """単一セグメント（数値または範囲）を数値リストに変換（・区切りの各パーツ用）"""
        seg = self._normalize_digits(seg.strip()).lstrip('#')
        m = re.match(r'^(.+?)[\-~ー〜～－‐−–—](.+)$', seg)
        if m:
            start_num = self._convert_single_number_float(m.group(1).strip().lstrip('#'))
            end_num   = self._convert_single_number_float(m.group(2).strip().lstrip('#'))
            if start_num is not None and end_num is not None and start_num <= end_num:
                return self._expand_range(start_num, end_num)
        num = self._convert_single_number_float(seg)
        return [num] if num is not None else []

    def _convert_single_number(self, value: str) -> Optional[int]:
        """単一の文字列を数値に変換"""
        value = self._normalize_digits(value.strip()).lstrip('#')
        # 「...」形式のサブタイトル部分を除去 (例: 48「開戦」→ 48)
        value = re.sub(r'「[^」]*」', '', value).strip()

        if value.isdigit():
            return int(value)

        lower_value = value.lower()
        if lower_value in self.ENGLISH_TO_NUM:
            return self.ENGLISH_TO_NUM[lower_value]

        # 英語の複合数字（例：twenty-one）
        if '-' in lower_value:
            parts = lower_value.split('-')
            total = 0
            for part in parts:
                if part in self.ENGLISH_TO_NUM:
                    total += self.ENGLISH_TO_NUM[part]
            if total > 0:
                return total

        kanji_num = self._convert_kanji_to_number(value)
        return kanji_num if kanji_num > 0 else None
    
    def _convert_kanji_to_number(self, kanji_str: str) -> int:
        """漢数字を数値に変換"""
        if len(kanji_str) == 1 and kanji_str in self.KANJI_TO_NUM:
            return self.KANJI_TO_NUM[kanji_str]
        
        total = 0
        
        if '十' in kanji_str or '拾' in kanji_str:
            ju_char = '十' if '十' in kanji_str else '拾'
            parts = kanji_str.split(ju_char)
            
            if parts[0]:
                tens_digit = self.KANJI_TO_NUM.get(parts[0], 1)
            else:
                tens_digit = 1
            
            total = tens_digit * 10
            
            if len(parts) > 1 and parts[1]:
                ones_digit = self.KANJI_TO_NUM.get(parts[1], 0)
                total += ones_digit
        else:
            for char in kanji_str:
                if char in self.KANJI_TO_NUM:
                    total += self.KANJI_TO_NUM[char]
        
        return total if total > 0 else 0
