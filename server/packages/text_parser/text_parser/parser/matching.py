"""解析の入口と、どのパターンに当たるかの調べ"""

import re
from typing import Dict, List, Any, Optional
from .common import (  # noqa: F401
    parser_errors,
)


class _MatchingMixin:
    """TextParser の一部（解析の入口と、どのパターンに当たるかの調べ）。"""

    def parse_text(self, text: str, context: Optional[Dict[str, Any]] = None, auto_send_rules: Optional[List[Dict[str, Any]]] = None, _match_info: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        """テキストを解析して結果を返す（中身は _parse_text）。

        しょぼいカレンダーの作品情報(作品名・略称・Wikipedia)を覚えて使い回す
        （shoboi_api の「作品情報の記憶」）。parser_error なしで終わった時だけ覚え、
        失敗した時は使った記憶も捨てる。
        """
        try:
            from .. import shoboi_api
        except Exception:
            return self._parse_text(text, context, auto_send_rules, _match_info)
        shoboi_api.begin_parse_capture()
        result = None
        try:
            result = self._parse_text(text, context, auto_send_rules, _match_info)
            return result
        finally:
            shoboi_api.end_parse_capture(bool(result) and not parser_errors(result))

    def parse_text_fresh(self, text: str, context: Optional[Dict[str, Any]] = None, **kwargs) -> Optional[Dict[str, Any]]:
        """覚えた作品情報を使わずに取り直して解析する（再解析ボタン用）。取り直した内容は覚え直す。"""
        try:
            from .. import shoboi_api
        except Exception:
            return self.parse_text(text, context, **kwargs)
        with shoboi_api.fresh():
            return self.parse_text(text, context, **kwargs)

    def _parse_text(self, text: str, context: Optional[Dict[str, Any]] = None, auto_send_rules: Optional[List[Dict[str, Any]]] = None, _match_info: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        """
        テキストを解析して結果を返す

        Args:
            text: 解析対象のテキスト
            context: 外部コンテキスト情報（例: {'start_time': '2024-01-01 23:00:00', 'sid': 23608}）
            auto_send_rules: auto_send 判定ルールのリスト。呼び出し側が JSON から読み込んで渡す。
                             各エントリの全フィールドが出力と一致した場合に auto_send=True をセット。

        Returns:
            解析結果の辞書、マッチしない場合はNone
        """
        # 1. context の全文字列を NFKC 正規化
        if context:
            context = self._normalize_context(context)
        # 2. context['title'] の [] を抽出して setting に、その後 [] を除去
        setting = ''
        if context and 'title' in context:
            setting = ''.join(re.findall(r'\[[^\]]*\]', context['title']))
            context = {**context, 'title': self._normalize_brackets(context['title']), 'setting': setting}
        # 3. text も [] 除去
        text = self._normalize_brackets(text)
        # パス1: else を除いて明示的な str マッチのみ試みる
        for _i, analyzer in enumerate(self.analyzers):
            result = self._try_parse(text, analyzer, context, allow_else=False)
            if result:
                result['setting'] = setting
                if _match_info is not None:
                    _match_info.append({'index': _i, 'pattern': analyzer.get('pattern'), 'pass': 1})
                return result
        # パス2: else のみで再試行（パス1でマッチしなかった場合のフォールバック）
        for _i, analyzer in enumerate(self.analyzers):
            result = self._try_parse(text, analyzer, context, allow_else=True)
            if result:
                result['setting'] = setting
                if result.get('else') == 'true' and auto_send_rules and self._check_auto_send(result, auto_send_rules):
                    result['auto_send'] = True
                if _match_info is not None:
                    _match_info.append({'index': _i, 'pattern': analyzer.get('pattern'), 'pass': 2})
                return result
        return None
    
    def check_matching_patterns(self, text: str, context: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """
        テキストに一致するすべてのパターンを確認

        Args:
            text: 解析対象のテキスト
            
        Returns:
            一致したパターン情報のリスト
            各要素には以下の情報が含まれる:
            - analyzer_index: アナライザーのインデックス
            - pattern_index: パターンに設定されたpattern_index（設定されている場合）
            - pattern: パターン文字列
            - matched_groups: マッチしたグループの値
            - parse_result: 解析結果
        """
        text = self._normalize_brackets(text)
        matching_patterns = []
        first_matched = False

        for idx, analyzer in enumerate(self.analyzers):
            pattern_template = analyzer.get('pattern')
            if not pattern_template:
                continue

            # 正規表現パターンを構築
            regex_pattern, group_mappings = self._build_regex_pattern(pattern_template, analyzer)

            # テキストとマッチング（全体一致を要求）
            match = re.fullmatch(regex_pattern, text)
            if match:
                parse_result = self._try_parse(text, analyzer, context)
                if not parse_result:
                    continue

                result_info = {
                    'analyzer_index': idx,
                    'pattern': pattern_template,
                }

                if 'pattern_index' in analyzer:
                    result_info['pattern_index'] = analyzer['pattern_index']

                if not first_matched:
                    # 最初（優先度最高）のマッチのみ詳細情報を取得
                    matched_groups = {}
                    for i, group_name in enumerate(group_mappings, start=1):
                        matched_groups[group_name] = match.group(i)

                    result_info['regex_pattern'] = regex_pattern
                    result_info['matched_groups'] = matched_groups
                    result_info['parse_result'] = parse_result
                    first_matched = True

                matching_patterns.append(result_info)

        return matching_patterns

    @staticmethod
    def _classify_match(analyzer: Dict[str, Any], groups: Dict[str, Any]):
        """マッチ種別を返す (match_type, matched_str, is_explicit)。アクションは実行しない。
        - list  : switch値が list に登録済み(明示) → explicit
        - direct: switch 無し(直接analyze) → explicit
        - else  : switch値が list 未登録で else にフォールバック → 非explicit
                  ただし退化switch(パターン未捕捉のswitch変数)は編集上は else 扱いだが
                  採用上は explicit(parse_text の pass1 相当)。
        戻り match_type=None はマッチ扱いしない(switchでlistもelseも無い)。"""
        for item in analyzer.get('analyze', []):
            if 'switch' in item:
                mm = re.match(r'\{\$(\d+)\}', item.get('switch', ''))
                if not mm:
                    return (None, None, None)
                gname = f"g{mm.group(1)}"
                degenerate = gname not in groups
                swval = groups.get(gname)
                for li in (item.get('list') or []):
                    if not degenerate and li.get('str') == swval:
                        return ('list', swval, True)
                if item.get('else'):
                    return ('else', None, True if degenerate else False)
                return (None, None, None)
        return ('direct', None, True)

    def match_report(self, text: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """パターン登録画面の「完全マッチ」用。text にマッチする全アナライザを返す。

        正規化・正規表現構築は _normalize_brackets / _build_regex_pattern を使い(=parse_text と
        同じ基準。全角空白の NFKC 等の乖離を無くす)、アクションは実行しない(API 呼び出し無し・軽量)。
        採用(adopted)は parse_text と同じ規則: 出現順で最初の明示(list/direct/退化else)、無ければ最初の else。

        戻り値: {'matches': [{index, pattern, match_type, matched_str, groups, explicit}...],
                 'adopted_index': int | None}
        """
        text_n = self._normalize_brackets(text)
        matches = []
        for idx, analyzer in enumerate(self.analyzers):
            pat = analyzer.get('pattern')
            if not pat:
                continue
            try:
                regex, group_mappings = self._build_regex_pattern(pat, analyzer)
                m = re.fullmatch(regex, text_n)
            except Exception:
                continue
            if not m:
                continue
            groups = {g: m.group(i) for i, g in enumerate(group_mappings, start=1)}
            # pattern2 (トップレベル AND 条件) [実験的] — _try_parse と同じ判定
            if analyzer.get('pattern2'):
                t2expr = analyzer.get('text2')
                if not t2expr:
                    continue
                t2 = self._resolve_context_refs(t2expr, context)
                if not t2 or re.search(r'\$[a-zA-Z_]\w*', t2):
                    continue
                t2 = self._normalize_brackets(t2)
                try:
                    rgx2, gm2 = self._build_regex_pattern(
                        analyzer['pattern2'], {'pattern': analyzer['pattern2'], 'analyze': analyzer.get('analyze', [])})
                    m2 = re.search(rgx2, t2, re.DOTALL)
                except Exception:
                    m2 = None
                if not m2:
                    continue
                for i, g in enumerate(gm2, start=1):
                    groups[g] = m2.group(i)
            mtype, matched_str, explicit = self._classify_match(analyzer, groups)
            if mtype is None:
                continue
            matches.append({'index': idx, 'pattern': pat, 'match_type': mtype,
                            'matched_str': matched_str, 'groups': groups, 'explicit': explicit})
        adopted = next((mm['index'] for mm in matches if mm['explicit']), None)
        if adopted is None:
            adopted = next((mm['index'] for mm in matches if not mm['explicit']), None)
        return {'matches': matches, 'adopted_index': adopted}

    def find_patterns_by_string(self, text: str, context: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """
        指定したテキストにマッチ可能なパターンを検索
        設定に定義されていない新しいテキストでも、既存のパターン構造に当てはまるかをチェック
        
        Args:
            text: チェックするテキスト文字列
            
        Returns:
            マッチ可能なパターン情報のリスト
            各要素には以下の情報が含まれる:
            - analyzer_index: アナライザーのインデックス
            - pattern_index: パターンに設定されたpattern_index（設定されている場合）
            - pattern: パターン文字列
            - matched_groups: マッチしたグループの値（パターン構造としてマッチした場合）
            - can_parse: 解析可能かどうか（switch条件も満たすか）
            - parse_result: 解析結果（can_parseがTrueの場合のみ）
        """
        text = self._normalize_brackets(text)
        matching_patterns = []

        for idx, analyzer in enumerate(self.analyzers):
            pattern_template = analyzer.get('pattern')
            if not pattern_template:
                continue

            # パターンの固定文字列部分のみでマッチングを試みる
            # プレースホルダーは全て .*? に置き換えて構造マッチをチェック
            placeholder_pattern = re.compile(r'\{\$\d+\}')

            # 構造マッチ用に [字] などを正規化したパターンを使用
            normalized_pattern_template = self._normalize_brackets(pattern_template)

            # パターンから固定文字列とプレースホルダーを分離
            parts = []
            last_end = 0
            placeholders = []

            # 全てのプレースホルダーを取得
            all_placeholders = list(placeholder_pattern.finditer(normalized_pattern_template))

            for i, match in enumerate(all_placeholders):
                # プレースホルダー前の固定文字列
                if match.start() > last_end:
                    parts.append(re.escape(normalized_pattern_template[last_end:match.start()]))

                # プレースホルダーを記録
                placeholders.append(match.group())
                # 最後のプレースホルダーは貪欲マッチ、それ以外は非貪欲マッチ
                is_last = (i == len(all_placeholders) - 1)
                parts.append('(.*)' if is_last else '(.*?)')
                last_end = match.end()

            # 最後の固定文字列
            if last_end < len(normalized_pattern_template):
                parts.append(re.escape(normalized_pattern_template[last_end:]))
            
            # 正規表現パターンを構築
            structure_pattern = ''.join(parts)
            
            # テキストとマッチング（全体一致を要求）
            match = re.fullmatch(structure_pattern, text)
            if match:
                # マッチしたグループの値を取得
                matched_groups = {}
                for i, placeholder in enumerate(placeholders, start=1):
                    group_num = placeholder.replace('{$', '').replace('}', '')
                    group_name = f"g{group_num}"
                    matched_groups[group_name] = match.group(i)
                
                # 実際に解析可能かチェック（switch条件も満たすか）
                parse_result = self._try_parse(text, analyzer, context)
                can_parse = bool(parse_result)
                
                result_info = {
                    'analyzer_index': idx,
                    'pattern': pattern_template,
                    'matched_groups': matched_groups,
                    'can_parse': can_parse
                }
                
                # 解析結果がある場合は追加
                if can_parse:
                    result_info['parse_result'] = parse_result
                
                # pattern_indexが設定されている場合は追加
                if 'pattern_index' in analyzer:
                    result_info['pattern_index'] = analyzer['pattern_index']
                
                matching_patterns.append(result_info)
        
        return matching_patterns

    def get_debug_info(self, text: str, analyzer: Dict[str, Any]) -> Dict[str, Any]:
        """デバッグ情報を取得"""
        pattern_template = analyzer.get('pattern', '')
        
        # 正規表現パターンを構築
        regex_pattern, group_mappings = self._build_regex_pattern(pattern_template, analyzer)
        
        # マッチを試行（全体一致を要求）
        match = re.fullmatch(regex_pattern, text)
        
        return {
            'text': text,
            'pattern_template': pattern_template,
            'regex_pattern': regex_pattern,
            'match_result': match.groups() if match else None,
            'match_groupdict': match.groupdict() if match else None,
            'group_mappings': group_mappings
        }
