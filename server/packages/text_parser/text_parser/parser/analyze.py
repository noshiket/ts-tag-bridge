"""analyze のアクションを順に実行する"""

import re
from typing import Dict, List, Any, Optional, Union
from ..paths import _sanitize_path_var
from .. import actions as parser_actions
from .common import (  # noqa: F401
    _PatternTextNotFoundError,
    _pa_branch_key,
)


class _AnalyzeMixin:
    """TextParser の一部（analyze のアクションを順に実行する）。"""

    def _process_analyze_list(self, analyze_configs: List[Dict[str, Any]], matched_groups: Dict[str, str], context: Optional[Dict[str, Any]], allow_else: bool = True, _errors: Optional[List[str]] = None, _path: Optional[List[str]] = None) -> Dict[str, Any]:
        """analyze リストを処理する（中身は _process_analyze_list_body）。

        parse_text の外から直接呼ばれた時（パターン画面の「解析」= test_analyze）も、
        parse_text と同じ規則でしょぼいカレンダーの応答を番組ごとに覚えて使い回す。
        解析の途中（parse_text や再帰の中）ならそのまま通す。
        """
        try:
            from .. import shoboi_api
        except Exception:
            shoboi_api = None
        if shoboi_api is None or shoboi_api.in_parse_capture():
            return self._process_analyze_list_body(analyze_configs, matched_groups, context,
                                                   allow_else, _errors, _path)
        errors = _errors if _errors is not None else []
        n_before = len(errors)
        shoboi_api.begin_parse_capture()
        result = None
        try:
            result = self._process_analyze_list_body(analyze_configs, matched_groups, context,
                                                     allow_else, errors, _path)
            return result
        finally:
            shoboi_api.end_parse_capture(bool(result) and len(errors) == n_before)

    def _process_analyze_list_body(self, analyze_configs: List[Dict[str, Any]], matched_groups: Dict[str, str], context: Optional[Dict[str, Any]], allow_else: bool = True, _errors: Optional[List[str]] = None, _path: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        analyzeリストを順次処理する（再帰呼び出し対応）

        Args:
            analyze_configs: 処理する設定リスト
            matched_groups: 現在のスコープでのマッチ結果 {'g1': '...', 'g2': '...'}
            context: 外部コンテキスト

        Returns:
            抽出されたフィールドの辞書
        """
        if _path is None:
            _path = []
        result = {}
        _else_needed = False  # allow_else=False 時に else が必要だったかを記録

        for _order, analyze_config in enumerate(analyze_configs):
            # --- ケース1: switch分岐 ---
            if 'switch' in analyze_config:
                if self._run_switch(analyze_config, matched_groups, context, allow_else,
                                    _errors, _path, result, _order):
                    _else_needed = True
                continue

            # --- 文字を取ってくるアクション（アドオンの fetch_text）---
            # pattern キーを持つが pattern アクションではない（先に振り分ける）。
            # pattern/analyze は取ってきた文字に対して遅延適用するため、
            # ここでは _process_sub_analyze でマーカー化のみ行う。
            if parser_actions.fetch_text_key(analyze_config):
                field_result = self._process_sub_analyze(analyze_config, matched_groups, context, _errors=_errors, _path=_path)
                if field_result is not None:
                    self._merge_analyze_result(result, field_result, _order)
                continue

            # --- ケース2: pattern (別テキストの入れ子解析) ---
            if 'pattern' in analyze_config:
                self._run_nested_pattern(analyze_config, context, allow_else, _errors, _path, result, _order)
                continue

            # --- 分岐アドオン (target='parser_action' かつ branching=True) ---
            _branch_key = _pa_branch_key(analyze_config)
            if _branch_key:
                self._run_branch_addon(_branch_key, analyze_config, matched_groups, context, allow_else,
                                       _errors, _path, result, _order)
                continue

            # --- ケース3: 通常のフィールド抽出 (setStr, setNum, API等) ---
            # switchもpatternもない場合は、既存の_process_sub_analyzeで処理
            field_result = self._process_sub_analyze(analyze_config, matched_groups, context, _errors=_errors, _path=_path)
            if field_result is not None:
                self._merge_analyze_result(result, field_result, _order)

        if _else_needed:
            return None

        # API依存フィールドの遅延評価を解決（passes 2-7）
        self._resolve_deferred(result, context, _errors=_errors, _path=_path)
        self._post_process_fields(result, context)
        return result

    def _merge_analyze_result(self, target: dict, updates: dict, order: int = 0):
        """子の解析結果を、呼び出し順(order)を守って target へ入れる。"""
        for k, v in updates.items():
            existing = target.get(k)
            if isinstance(existing, dict) and ('_getEpisodeFromSid' in existing or '_getShoboiSubtitle' in existing or '_getShoboiEpisode' in existing or '_getFromSid' in existing or '_getFromTitleAndEpisode' in existing or '_fetchText' in existing):
                # 既存が未解決マーカーの場合は上書きしない。ただし combine フィールドなら
                # 新値を結合セグメントとして控えておき、マーカー解決時に呼び出し順で合流させる
                if k in self._COMBINE_FIELDS and not self._is_deferred_marker(v):
                    segs = target.setdefault(self._COMBINE_ORDER_KEY, {}).setdefault(k, [])
                    segs.append((order, v))
                continue
            if isinstance(v, dict) and '_addList' in v:
                # _resolve_deferred 後にポスト処理で解決するため保留
                pending_key = f'__addList_{k}'
                target[pending_key] = target.get(pending_key, []) + [v['template']]
            elif self._is_deferred_marker(v):
                # 遅延マーカーには呼び出し順(order)を刻んでおき、解決時に結合位置として使う
                v['_order'] = order
                target[k] = v
            else:
                # episode_name/episode_number は呼び出し順でリスト結合、それ以外は上書き
                self._set_or_combine(target, k, v, order)

    def _run_switch(self, analyze_config, matched_groups, context, allow_else, _errors, _path, result, order) -> bool:
        """switch 分岐。一致した list の子 analyze（無ければ else）を実行して result へ入れる。
        allow_else=False で else が要った時は True を返す（呼び出し側がこの解析を捨てる）。"""
        switch_target = analyze_config.get('switch', '')

        # {$N}形式からグループ名を取得
        group_match = re.match(r'\{\$(\d+)\}', switch_target)
        if not group_match:
            return False

        group_name = f"g{group_match.group(1)}"
        # switch 変数がパターンで捕捉されていない(=matched_groups に無い)場合は
        # 「退化した switch」。この switch は list に決してマッチせず常に else に落ちるため、
        # else を無条件の直接 analyze として実行する(= pass1 の明示マッチ扱い)。
        # これにより固定文字数優先(_analyzer_priority)が効き、汎用 list パターンに
        # 食われなくなる。例: pattern が {$3}{$4} なのに switch が {$1} のケース。
        degenerate_switch = group_name not in matched_groups
        switch_value = matched_groups.get(group_name, '')

        for list_item in analyze_config.get('list', []):
            if switch_value == list_item.get('str', ''):
                # 再帰呼び出し: マッチしたブロックのanalyzeを実行
                sub_analyze = list_item.get('analyze', [])
                sub_result = self._process_analyze_list(sub_analyze, matched_groups, context, allow_else=allow_else, _errors=_errors, _path=_path + ['switch'])
                self._merge_analyze_result(result, sub_result, order)
                return False
        # いずれにもマッチしなかった場合は else フォールバック
        else_analyze = analyze_config.get('else', [])
        if not else_analyze:
            return False
        if degenerate_switch:
            # 退化 switch: else を直接マッチ扱いで無条件実行(else マーカーは付けない)
            sub_result = self._process_analyze_list(else_analyze, matched_groups, context, allow_else=allow_else, _errors=_errors, _path=_path + ['switch'])
            self._merge_analyze_result(result, sub_result, order)
        elif allow_else:
            sub_result = self._process_analyze_list(else_analyze, matched_groups, context, allow_else=allow_else, _errors=_errors, _path=_path + ['switch'])
            self._merge_analyze_result(result, sub_result, order)
            result['else'] = 'true'
        else:
            return True
        return False

    def _run_nested_pattern(self, analyze_config, context, allow_else, _errors, _path, result, order):
        """pattern: 別のテキスト（$description など）を入れ子のパターンで解析し、子 analyze を実行する。"""
        nested_pattern_template = analyze_config['pattern']
        target_text_expr = analyze_config.get('text') or '$title'
        target_text = self._nested_target_text(target_text_expr, context, 'text')

        # ネスト用の正規表現構築
        # _build_regex_patternはanalyzer辞書を期待するため、一時的な辞書を作成
        temp_analyzer = {
            'pattern': nested_pattern_template,
            'analyze': analyze_config.get('analyze', [])
        }

        regex_pattern, group_mappings = self._build_regex_pattern(nested_pattern_template, temp_analyzer)

        # 新しいテキストに対してマッチング
        # re.searchを使用: descriptionの先頭以外の位置にパターンが出現する場合も検出
        # DOTALL: description/extended_info は複数行のため {$N}(=.*?)が改行を跨げるように
        match = re.search(regex_pattern, target_text, re.DOTALL)
        if not match:
            return
        # ネスト内部用の新しいグループ辞書を作成 (g1, g2... はここでリセットされる)
        nested_groups = {}
        for i, group_name in enumerate(group_mappings, start=1):
            nested_groups[group_name] = match.group(i)

        # --- pattern2 / text2 (AND条件) [実験的機能] ---
        if 'pattern2' in analyze_config:
            target_text2_expr = analyze_config.get('text2')
            if not target_text2_expr:
                raise ValueError("pattern2 を指定する場合は text2 も必須です")
            target_text2 = self._nested_target_text(target_text2_expr, context, 'text2')
            nested_pattern_template2 = analyze_config['pattern2']
            temp_analyzer2 = {'pattern': nested_pattern_template2, 'analyze': analyze_config.get('analyze', [])}
            regex_pattern2, group_mappings2 = self._build_regex_pattern(nested_pattern_template2, temp_analyzer2)
            # DOTALL: description/extended_info は複数行のため {$N}(=.*?)が改行を跨げるように
            match2 = re.search(regex_pattern2, target_text2, re.DOTALL)
            if not match2:
                return  # pattern2 がマッチしなければスキップ

            # pattern2 の各グループは _build_regex_pattern が返す実グループ名
            # (ユーザーが書いた {$N} の番号)へ格納する。analyze は番号で参照するため、
            # 位置ベースの g{offset+i} だと非連番でズレる。連番なら従来と同一。
            for i, gname in enumerate(group_mappings2, start=1):
                nested_groups[gname] = match2.group(i)

        # 再帰呼び出し: 新しいグループ情報を使って内部analyzeを実行
        sub_analyze = analyze_config.get('analyze', [])
        sub_result = self._process_analyze_list(sub_analyze, nested_groups, context, allow_else=allow_else, _errors=_errors, _path=_path + ['pattern'])
        self._merge_analyze_result(result, sub_result, order)

    def _nested_target_text(self, expr, context, label):
        """入れ子パターンで読むテキスト（$description など）を context から取り、放送マークを正規化する。
        取れない・解決しきれない時は _PatternTextNotFoundError。"""
        # テキスト変数の解決 (例: "$new_text" -> context['new_text']の中身)
        text = self._resolve_context_refs(expr, context)
        if not text:
            raise _PatternTextNotFoundError(
                f"{label}変数 '{expr}' が見つかりません（contextに存在しないか空）"
            )
        # コンテキスト参照が未解決のまま残っている場合も失敗
        if re.search(r'\$[a-zA-Z_]\w*', text):
            raise _PatternTextNotFoundError(
                f"{label}変数 '{expr}' が未解決のまま残っています: '{text}'"
            )
        # [字] などの放送マークを正規化
        return self._normalize_brackets(text)

    def _run_branch_addon(self, branch_key, analyze_config, matched_groups, context, allow_else,
                          _errors, _path, result, order):
        """分岐アドオン (target='parser_action' かつ branching=True)。

        switch と同じく「条件で子アクションを選んで実行する」もの。アドオンは
        選んだ子 analyze を返すだけで、実行はここで再帰的に行う
        (アドオン側から解析器を呼び戻させない＝暴走やネスト管理を持ち込ませない)。
        """
        from .. import actions as _pa
        _plain = {k[1:]: v for k, v in (matched_groups or {}).items() if k.startswith('g')}
        _picked = _pa.run(branch_key, analyze_config, groups=_plain, context=context)
        _sub = (_picked or {}).get('analyze') if isinstance(_picked, dict) else None
        if _sub:
            sub_result = self._process_analyze_list(
                _sub, matched_groups, context, allow_else=allow_else,
                _errors=_errors, _path=_path + [branch_key])
            self._merge_analyze_result(result, sub_result, order)

    def _post_process_fields(self, result, context):
        """出力フィールドが揃ってから決めるもの（addList・アドオンの後回しアクション・setPath）を展開する。"""
        # ポスト処理: addList の保留テンプレートを出力フィールドで解決
        for k in list(result.keys()):
            if k.startswith('__addList_'):
                field_name = k[len('__addList_'):]
                templates = result.pop(k)
                for tmpl in templates:
                    resolved = re.sub(
                        r'\{\$([a-zA-Z_]\w*)\}',
                        lambda m: str(result.get(m.group(1), m.group(0))),
                        tmpl
                    )
                    existing = result.get(field_name)
                    result[field_name] = (existing + [resolved]) if isinstance(existing, list) else [resolved]

        # 結合順序の内部キーを除去(出力に漏らさない)。episode_name/number の最終値は
        # 既に result[field] に確定済み(_set_or_combine が呼び出し順で整列済み)。
        self._finalize_combine(result)

        # ポスト処理: _setPath マーカーを出力フィールドで展開
        # context からはシステム変数のみを注入し、出力フィールドと同名の場合は出力フィールドを優先
        _SETPATH_CTX_KEYS = ('encode_dir', 'ext', 'service_name', 'start_time', 'sid', 'onid', 'tsid', 'setting')
        _ctx_sys = {k: context[k] for k in _SETPATH_CTX_KEYS if context and k in context}
        # ポスト処理: アドオンアクション(deferred)を出力フィールドが揃った状態で実行
        from .. import actions as _pa
        for k in list(result.keys()):
            v = result[k]
            if isinstance(v, dict) and _pa.MARKER in v:
                value = _pa.run(v[_pa.MARKER], v.get('config'), groups=v.get('groups'),
                                context=context, fields={kk: vv for kk, vv in result.items()
                                                         if not isinstance(vv, dict)})
                if value is None:
                    result.pop(k, None)
                else:
                    result[k] = value

        for k in list(result.keys()):
            v = result[k]
            if isinstance(v, dict) and '_setPath' in v:
                path_vars = {**_ctx_sys, **result}  # result が優先
                result[k] = self._resolve_set_path(v['template'], path_vars)
                result[k + '_format'] = self._resolve_set_path_format(v['template'], _ctx_sys, result)

    def _resolve_set_path(self, template: str, result: dict,
                          context: Optional[Dict[str, Any]] = None) -> Union[str, List[str]]:
        """setPath テンプレートを result の出力フィールドで展開してパスを生成する。

        {$varname} または $varname で result 内フィールドを参照（優先）。
        result にない変数は context から解決（フォールバック）。
        リストフィールドがあれば zip して複数パスを生成する。
        1件のみなら文字列、2件以上ならリストを返す。
        """
        # {$varname} と $varname 両方の変数名を収集
        braced_vars = set(re.findall(r'\{\$([a-zA-Z_]\w*)\}', template))
        bare_vars = set(re.findall(r'\$([a-zA-Z_]\w*)', template))
        var_names = braced_vars | bare_vars

        list_fields: dict = {}
        str_fields: dict = {}
        for var in var_names:
            if var in result:
                val = result[var]
                if isinstance(val, list):
                    list_fields[var] = [_sanitize_path_var(var, str(v) if v is not None else '') for v in val]
                else:
                    str_fields[var] = _sanitize_path_var(var, str(val) if val is not None else '')
            elif context and var in context:
                str_fields[var] = _sanitize_path_var(var, str(context[var]) if context[var] is not None else '')

        def expand(index=None):
            def replace_ref(match):
                var = match.group(1)
                if var in list_fields:
                    vals = list_fields[var]
                    return vals[index] if index is not None and index < len(vals) else ''
                if var in str_fields:
                    return str_fields[var]
                return match.group(0)  # 未解決のまま残す
            # {$varname} を先に解決（曖昧さなし）してから $varname を解決
            out = re.sub(r'\{\$([a-zA-Z_]\w*)\}', replace_ref, template)
            out = re.sub(r'\$([a-zA-Z_]\w*)', replace_ref, out)
            return out

        if not list_fields:
            return expand()

        count = max(len(v) for v in list_fields.values())
        paths = [expand(i) for i in range(count)]
        return paths[0] if len(paths) == 1 else paths

    def _resolve_set_path_format(self, template: str, ctx_vars: dict, output_fields: dict) -> str:
        """setPath テンプレートからフォーマット文字列を生成する。

        - コンテキスト変数（encode_dir, ext, sid, start_time 等）→ 実際の値で置換
        - 出力フィールド参照（title, folder, episode_number 等）→ {} に置換
        """
        def replace_braced(match):
            var = match.group(1)
            if var in output_fields:
                return '{$' + var + '}'
            if var in ctx_vars:
                return _sanitize_path_var(var, str(ctx_vars[var]) if ctx_vars[var] is not None else '')
            return match.group(0)

        def replace_bare(match):
            var = match.group(1)
            # 出力フィールドは1パス目で処理済み。コンテキスト変数のみ置換。
            if var in ctx_vars and var not in output_fields:
                return _sanitize_path_var(var, str(ctx_vars[var]) if ctx_vars[var] is not None else '')
            return match.group(0)

        out = re.sub(r'\{\$([a-zA-Z_]\w*)\}', replace_braced, template)
        out = re.sub(r'\$([a-zA-Z_]\w*)', replace_bare, out)
        return out

    def _resolve_context_refs(self, value: str, context: Optional[Dict[str, Any]]) -> str:
        """文字列中の $varname をコンテキストから解決する

        例: "$sid" → context['sid'] の値
            "prefix_$start_time" → "prefix_" + context['start_time'] の値
        """
        if not value or not isinstance(value, str) or not context:
            return value

        def replace_ref(match):
            var_name = match.group(1)
            return str(context.get(var_name, match.group(0)))

        return re.sub(r'\$([a-zA-Z_]\w*)', replace_ref, value)
