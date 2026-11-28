"""1つのパターンで解析し、後回しにした値を解決する"""

import re
import unicodedata
from typing import Dict, List, Any, Optional
from ..fetchers.core import ShoboiInfoFetcher
from .. import actions as parser_actions
from .common import (  # noqa: F401
    _PatternTextNotFoundError,
)


class _ResolveMixin:
    """TextParser の一部（1つのパターンで解析し、後回しにした値を解決する）。"""

    def _try_parse(self, text: str, analyzer: Dict[str, Any], context: Optional[Dict[str, Any]] = None, allow_else: bool = True) -> Optional[Dict[str, Any]]:
            """
            1つのアナライザーでテキストを解析
            """
            pattern_template = analyzer.get('pattern')
            if not pattern_template:
                return None
            
            analyze_configs = analyzer.get('analyze', [])
            if not analyze_configs:
                return None

            # text フィールドが指定されている場合はそのコンテキスト変数を使用
            text_expr = analyzer.get('text')
            if text_expr:
                text = self._resolve_context_refs(text_expr, context)
                if not text:
                    return None

            # [字] などの放送マークを正規化
            text = self._normalize_brackets(text)

            # 正規表現パターンを構築
            regex_pattern, group_mappings = self._build_regex_pattern(pattern_template, analyzer)

            # テキストとマッチング（全体一致を要求）
            match = re.fullmatch(regex_pattern, text)
            if not match:
                return None
            
            # マッチしたグループの値を取得
            matched_groups = {}
            for i, group_name in enumerate(group_mappings, start=1):
                matched_groups[group_name] = match.group(i)

            # pattern2 / text2 (トップレベル AND条件) [実験的機能]
            if 'pattern2' in analyzer:
                target_text2_expr = analyzer.get('text2')
                if not target_text2_expr:
                    raise ValueError("pattern2 を指定する場合は text2 も必須です")
                target_text2 = self._resolve_context_refs(target_text2_expr, context)
                if not target_text2 or re.search(r'\$[a-zA-Z_]\w*', target_text2):
                    return None
                target_text2 = self._normalize_brackets(target_text2)
                temp_analyzer2 = {'pattern': analyzer['pattern2'], 'analyze': analyzer.get('analyze', [])}
                regex_pattern2, group_mappings2 = self._build_regex_pattern(analyzer['pattern2'], temp_analyzer2)
                # description/extended_info は複数行のため DOTALL: {$N}(=.*?)が改行を跨げるように
                match2 = re.search(regex_pattern2, target_text2, re.DOTALL)
                if not match2:
                    return None
                # pattern2 の各グループは _build_regex_pattern が返す実グループ名
                # (ユーザーが書いた {$N} の番号: g4,g8,g5 ...)へ格納する。
                # analyze は {$N} を番号で参照するため、位置ベースの g{offset+i} で
                # 振り直すと非連番(例 {$4} #{$8} {$5})でズレる。連番なら従来と同一。
                for i, gname in enumerate(group_mappings2, start=1):
                    matched_groups[gname] = match2.group(i)

            # 解析設定を処理（再帰ロジックへ委譲）
            # text変数が見つからない場合は _PatternTextNotFoundError が送出され、
            # このアナライザーはマッチ失敗として扱う
            try:
                _errors = []
                result = self._process_analyze_list(analyze_configs, matched_groups, context, allow_else=allow_else, _errors=_errors)
            except _PatternTextNotFoundError:
                return None

            if result is not None and _errors:
                result['parser_error'] = _errors
            return result

    def _resolve_deferred(self, result: dict, context: Optional[Dict[str, Any]], _errors: Optional[List[str]] = None, _path: Optional[List[str]] = None) -> dict:
        """API依存フィールドのプレースホルダーを解決する（遅延評価 passes 2-7）。

        context に _skip_external=True があるときは、しょぼいカレンダーへの同期HTTP
        (1件あたり最大10秒)を一切行わず、未解決のプレースホルダーを空にして返す。
        録画結果の解析プレビューのように「どのパターンが採用されるか」だけ見たい用途で使う。
        """
        if context and context.get('_skip_external'):
            # この時点で dict 値になっているのは遅延解決のプレースホルダーだけ
            # (通常の解析結果は str / list)。空にして簡易表示にする。
            for _k, _v in list(result.items()):
                if isinstance(_v, dict):
                    result[_k] = ''
            return result
        rate_limit_error = _rate_limit_error_class()
        # 2〜7パス目。前のパスで決まった値（話数など）を後のパスが使うので、この順に解決する
        self._resolve_episode_from_sid(result, context, _errors, _path)
        self._resolve_shoboi_subtitle(result, _errors, _path)
        self._resolve_shoboi_episode(result, _errors, _path)
        self._resolve_from_sid(result, context, _errors, _path, rate_limit_error)
        self._resolve_from_title_and_episode(result, context, _errors, _path, rate_limit_error)
        self._resolve_fetch_text(result, context, _errors, _path)
        return result

    def _resolve_episode_from_sid(self, result, context, _errors, _path):
        """2パス目: getEpisodeFromSid（SID と放送日時から話数）。"""
        episode_sid_fields = {}  # field_name -> (order, value)
        for field_name, field_value in list(result.items()):
            if isinstance(field_value, dict) and field_value.get('_getEpisodeFromSid'):
                _ord = field_value.get('_order', 0)
                sid = self._placeholder_sid(field_value['sid'], context, use_context_sid=False)
                _field, start_time = _placeholder_start_time(field_value['startTimeField'], context, result)
                if sid and start_time:
                    try:
                        programs_cache = context.get('programs_cache') if context else None
                        if programs_cache is not None:
                            episode = ShoboiInfoFetcher.find_episode_in_cache(programs_cache, str(start_time))
                        else:
                            episode = self._get_fetcher().get_episode_from_sid_and_time(int(sid), str(start_time))
                        if episode is None and context:
                            episode = ShoboiInfoFetcher.extract_episodes_from_text(str(context.get('description', '') or ''))
                        episode_sid_fields[field_name] = (_ord, episode)
                    except Exception as e:
                        print(f"[getEpisodeFromSid] エラー SID={sid}, start_time={start_time}: {e}")
                        episode_sid_fields[field_name] = (_ord, None)
                else:
                    episode_sid_fields[field_name] = (_ord, None)
                del result[field_name]
        for field_name, (_ord, val) in episode_sid_fields.items():
            if val is not None:
                self._set_or_combine(result, field_name, val, _ord)
        if _errors is not None:
            for field_name, (_ord, val) in episode_sid_fields.items():
                if val is None:
                    _errors.append(_error_name(_path, 'getEpisodeFromSid', field_name))

    def _resolve_shoboi_subtitle(self, result, _errors, _path):
        """3パス目: getShoboiSubtitle（作品の TID と話数から副題）。"""
        shoboi_fields = {}  # field_name -> (order, value)
        for field_name, field_value in list(result.items()):
            if isinstance(field_value, dict) and field_value.get('_getShoboiSubtitle'):
                _ord = field_value.get('_order', 0)
                tid = field_value['tid']
                episode_field = field_value['episodeField'] or 'episode'
                if tid and episode_field and episode_field in result:
                    count = result[episode_field]
                    try:
                        from ..shoboi_api import CompleteProgramFinder
                        finder = CompleteProgramFinder()
                        all_subtitles = finder.get_all_subtitles(tid)
                        subtitles_map = {
                            int(ep_info['count']): ep_info['subtitle']
                            for ep_info in all_subtitles
                            if ep_info['count'].isdigit()
                        }
                        if isinstance(count, list):
                            shoboi_fields[field_name] = (_ord, [subtitles_map.get(ep, '') for ep in count])
                        else:
                            shoboi_fields[field_name] = (_ord, subtitles_map.get(int(count) if str(count).isdigit() else 0, ''))
                    except Exception as e:
                        print(f"[getShoboiSubtitle] エラー TID={tid}, count={count}: {e}")
                        if isinstance(count, list):
                            shoboi_fields[field_name] = (_ord, [''] * len(count))
                        else:
                            shoboi_fields[field_name] = (_ord, '')
                del result[field_name]
        for field_name, (_ord, val) in shoboi_fields.items():
            self._set_or_combine(result, field_name, val, _ord)
        if _errors is not None:
            for field_name, (_ord, val) in shoboi_fields.items():
                if not val or (isinstance(val, list) and not any(val)):
                    _errors.append(_error_name(_path, 'getShoboiSubtitle', field_name))

    def _resolve_shoboi_episode(self, result, _errors, _path):
        """4パス目: getShoboiEpisode（副題から話数を逆引き）。"""
        shoboi_episode_fields = {}  # field_name -> (order, value)
        for field_name, field_value in list(result.items()):
            if isinstance(field_value, dict) and field_value.get('_getShoboiEpisode'):
                _ord = field_value.get('_order', 0)
                tid = field_value['tid']
                subtitle_field = field_value['subtitleField'] or 'subtitle'
                subtitle = result.get(subtitle_field)
                if tid and subtitle:
                    try:
                        from ..shoboi_api import CompleteProgramFinder, SyobocalRateLimitError
                        import time as _time
                        finder = CompleteProgramFinder()
                        all_subtitles = []
                        for _attempt in range(3):
                            try:
                                all_subtitles = finder.get_all_subtitles(tid)
                                break
                            except SyobocalRateLimitError as _rle:
                                _wait = min(_rle.retry_after, 120)
                                print(f"[getShoboiEpisode] レート制限。{_wait}秒後にリトライ ({_attempt + 1}/3) TID={tid}")
                                if _attempt < 2:
                                    _time.sleep(_wait)
                        episode_map = {
                            unicodedata.normalize('NFKC', ep_info['subtitle']): int(ep_info['count'])
                            for ep_info in all_subtitles
                            if ep_info['count'].isdigit()
                        }
                        subtitle_norm = unicodedata.normalize('NFKC', subtitle)
                        shoboi_episode_fields[field_name] = (_ord, episode_map.get(subtitle_norm))
                    except Exception as e:
                        print(f"[getShoboiEpisode] エラー TID={tid}, subtitle={subtitle}: {e}")
                        shoboi_episode_fields[field_name] = (_ord, None)
                else:
                    shoboi_episode_fields[field_name] = (_ord, None)
                del result[field_name]
        for field_name, (_ord, val) in shoboi_episode_fields.items():
            if val is not None:
                self._set_or_combine(result, field_name, val, _ord)
        if _errors is not None:
            for field_name, (_ord, val) in shoboi_episode_fields.items():
                if val is None:
                    _errors.append(_error_name(_path, 'getShoboiEpisode', field_name))

    def _resolve_from_sid(self, result, context, _errors, _path, SyobocalRateLimitError):
        """5パス目: getFromSid（SID と放送日時から、しょぼいカレンダーの複数の値をまとめて）。"""
        get_from_sid_fields = {}
        for field_name, field_value in list(result.items()):
            if isinstance(field_value, dict) and field_value.get('_getFromSid'):
                get_from_sid_fields[field_name] = field_value
                del result[field_name]
        for placeholder_key, placeholder in get_from_sid_fields.items():
            _ord = placeholder.get('_order', 0)
            set_mapping = placeholder.get('set', {})
            sid = self._placeholder_sid(placeholder['sid'], context, use_context_sid=True)
            _field, start_time = _placeholder_start_time(placeholder['startTimeField'], context, result)
            announce_only = set(set_mapping.keys()) == {'sid-announce'}
            rate_limited = False
            if sid and start_time:
                try:
                    info = self._get_fetcher().get_all_info_from_sid_and_time(int(sid), str(start_time))
                    has_pid = bool(info and info.get('sid-pid'))
                    if has_pid:
                        for source_key, dest_key in set_mapping.items():
                            # sid- プレフィックスあり・なし両方を試みる
                            value = info.get(source_key)
                            if value is None:
                                value = info.get(f'sid-{source_key}')
                            if value is not None and value != '':
                                # episode_name/number は呼び出し順(_order)でリスト結合、他は上書き
                                self._set_or_combine(result, dest_key, value, _ord)
                        _auto_add_shoboi_meta(result, info, 'sid-')
                    elif announce_only:
                        announce_val = info.get('sid-announce', 'none(no pid)') if info else 'none(no pid)'
                        result[set_mapping['sid-announce']] = announce_val
                    else:
                        print(f"[getFromSid] pid取得失敗のためスキップ SID={sid}, start_time={start_time}")
                except SyobocalRateLimitError as e:
                    # レート制限は「取得失敗」ではないので個別フィールドのparser_errorにしない
                    rate_limited = True
                    print(f"[getFromSid] レート制限 SID={sid}: {e}")
                except Exception as e:
                    if announce_only:
                        result[set_mapping['sid-announce']] = 'none(no pid)'
                    else:
                        print(f"[getFromSid] エラー SID={sid}, start_time={start_time}: {e}")
            if _errors is not None:
                _errors.extend(_missing_errors(_path, 'getFromSid', rate_limited, set_mapping, result))

    def _resolve_from_title_and_episode(self, result, context, _errors, _path, SyobocalRateLimitError):
        """6パス目: getFromTitleAndEpisode（作品名と話数から、しょぼいカレンダーの値）。"""
        get_from_title_fields = {}
        for field_name, field_value in list(result.items()):
            if isinstance(field_value, dict) and field_value.get('_getFromTitleAndEpisode'):
                get_from_title_fields[field_name] = field_value
                del result[field_name]
        for placeholder_key, placeholder in get_from_title_fields.items():
            _ord = placeholder.get('_order', 0)
            title_str = self._resolve_context_refs(placeholder.get('title', ''), context)
            set_mapping = placeholder.get('set', {})
            episode_field = placeholder.get('episodeField', '')
            pending_eps = [t for t in result.get(f'__addList_{episode_field}', []) if '{$' not in t]
            if episode_field and episode_field in result:
                episode_val = result[episode_field]
            elif pending_eps:
                # addList はこの後で展開するので、保留中の値（{$N} は展開済み）を話数として使う
                episode_val = pending_eps if len(pending_eps) > 1 else pending_eps[0]
            else:
                raw_ep = placeholder.get('episode', '')
                episode_val = self._resolve_context_refs(str(raw_ep), context)
            rate_limited = False
            if title_str:
                try:
                    info = self._get_fetcher().get_info_from_title_and_episode(
                        title_str, episode_val,
                        program=((context or {}).get('sid'), (context or {}).get('start_time')))
                    if info is None:
                        print(f"[getFromTitleAndEpisode] マッチなし or 複数マッチ title={title_str!r}, episode={episode_val!r}")
                    else:
                        for source_key, dest_key in set_mapping.items():
                            # t- プレフィックスあり・なし両方を試みる
                            value = info.get(source_key)
                            if value is None:
                                value = info.get(f't-{source_key}')
                            if value is not None and value != '':
                                self._set_or_combine(result, dest_key, value, _ord)
                        _auto_add_shoboi_meta(result, info, 't-')
                except SyobocalRateLimitError as e:
                    rate_limited = True
                    print(f"[getFromTitleAndEpisode] レート制限 title={title_str!r}: {e}")
                except Exception as e:
                    print(f"[getFromTitleAndEpisode] エラー title={title_str!r}, episode={episode_val!r}: {e}")
            if _errors is not None:
                _errors.extend(_missing_errors(_path, 'getFromTitleAndEpisode', rate_limited, set_mapping, result))

    def _resolve_fetch_text(self, result, context, _errors, _path):
        """7パス目: 文字を取ってくるアクション（アドオンの fetch_text）。
        取ってきた文字をネスト pattern + 子 analyze で解析する。"""
        gft = result.pop('__fetchText__', None)
        if not (isinstance(gft, dict) and gft.get('_fetchText')):
            return
        key = gft.get('key', '')
        # sid を解決（補助。照合は title 主軸）
        sid = self._placeholder_sid(gft['sid'], context, use_context_sid=True)
        _field, start_time = _placeholder_start_time(gft.get('startTimeField', 'start_time'), context, result)
        # 照合タイトルを解決（{$N} は marker 生成時に解決済み）。
        # {$folder} のような出力フィールド参照はここで解決する。このパスは他のアクションが
        # 全て終わった後に走るので result に確定値が揃っている。最後に $context 変数を解決。
        def _field_ref(m):
            val = result.get(m.group(1), None)
            if val is None:
                return m.group(0)
            if isinstance(val, list):
                val = val[0] if val else ''
            return str(val)
        text = re.sub(r'\{\$([a-zA-Z_]\w*)\}', _field_ref, gft.get('textField', '$title'))
        text = self._resolve_context_refs(text, context)

        nested_pattern = gft.get('pattern', '')
        nested_analyze = gft.get('analyze', [])

        fetched = None
        if text:
            try:
                fetched = parser_actions.run_fetch_text(key, sid, str(start_time) if start_time else '', text)
            except Exception as e:
                print(f"[{key}] エラー text={text!r}, start_time={start_time}: {e}")

        if fetched is None:
            if _errors is not None:
                _errors.append(_error_name(_path, key, 'episode_name'))
            return
        # fetch_text は単一の文字、または候補の一覧を返す（一覧は pattern に当たったものを選ぶ）
        subs = fetched if isinstance(fetched, (list, tuple)) else [fetched]

        if not nested_pattern:
            # pattern 省略時は最初の空でない副題をそのまま episode_name にセット（フォールバック）
            first = next((s for s in subs if s), '')
            self._set_or_combine(result, 'episode_name', first, gft.get('_order', 0))
            return

        # 候補ごとにネスト pattern + 子 analyze を適用。最初に fullmatch したものを採用
        regex, group_mappings = self._build_regex_pattern(nested_pattern, {'analyze': nested_analyze})
        matched = False
        for sub in subs:
            if not sub:
                continue
            m = re.fullmatch(regex, self._normalize_brackets(sub))
            if not m:
                continue
            mg = {gname: m.group(i) for i, gname in enumerate(group_mappings, start=1)}
            # _process_analyze_list は末尾で _resolve_deferred を呼ぶため、
            # 子 analyze の遅延マーカー(getFromSid 等)もこの中で解決される。
            sub_result = self._process_analyze_list(
                nested_analyze, mg, context, _errors=_errors,
                _path=(_path or []) + [key])
            _fetch_ord = gft.get('_order', 0)
            for _k, _v in sub_result.items():
                self._set_or_combine(result, _k, _v, _fetch_ord)
            matched = True
            break
        if not matched and _errors is not None:
            _errors.append(_error_name(_path, key, 'pattern_no_match'))

    def _placeholder_sid(self, raw, context, use_context_sid):
        """プレースホルダーの sid（$sid 等は context で解決）を数にする。
        use_context_sid なら、決まらない時に context の sid を使う。"""
        sid_raw = str(raw) if raw is not None else ''
        sid_raw = self._resolve_context_refs(sid_raw, context)
        try:
            sid = int(sid_raw) if sid_raw else None
        except (ValueError, TypeError):
            sid = None
        if use_context_sid and not sid and context:
            ctx_sid = context.get('sid')
            if ctx_sid:
                try:
                    sid = int(ctx_sid)
                except (ValueError, TypeError):
                    pass
        return sid


def _placeholder_start_time(start_time_field, context, result):
    """放送開始時刻を探す。context の指定の名前 → context の start_time → 解析結果の指定の名前の順。
    (先頭の $ を除いた名前, 時刻) を返す。"""
    if start_time_field and start_time_field.startswith('$'):
        start_time_field = start_time_field[1:]
    start_time = None
    if context:
        start_time = context.get(start_time_field) or context.get('start_time')
    if not start_time and start_time_field and start_time_field in result:
        start_time = result[start_time_field]
    return start_time_field, start_time


def _error_name(path, action, name):
    """parser_error に入れる名前（例: 'getFromSid:episode_name'。入れ子なら親の名前が前に付く）。"""
    return '>'.join((path or []) + [action]) + ':' + name


def _missing_errors(path, action, rate_limited, set_mapping, result):
    """取れなかった出力の parser_error。規制で取れなかった時は1件だけ __rate_limited__ にする。"""
    if rate_limited:
        return [_error_name(path, action, '__rate_limited__')]
    return [_error_name(path, action, dest_key) for dest_key in set_mapping.values()
            if dest_key not in result]


def _rate_limit_error_class():
    """しょぼいカレンダーの規制の例外クラス（読めなければ、どれにも当たらない代わりのクラス）。"""
    try:
        from ..shoboi_api import SyobocalRateLimitError
    except Exception:
        class SyobocalRateLimitError(Exception):
            pass
    return SyobocalRateLimitError


def _auto_add_shoboi_meta(res, inf, prefix):
    """しょぼいAPIの取得結果を出力へ自動付与する(shoboi_url/shoboi_tid/wiki_urlは
    set マッピング対象ではなく、parser_error 等と同様に取得できたら自動で結果へ入れる)"""
    if not inf:
        return
    tid_v = inf.get(f'{prefix}shoboi_tid') or inf.get(f'{prefix}tid')
    if tid_v:
        res['shoboi_tid'] = tid_v
        res['shoboi_url'] = inf.get(f'{prefix}shoboi_url') or f'https://cal.syoboi.jp/tid/{tid_v}'
    wu = inf.get(f'{prefix}wiki_url')
    if wu:
        res['wiki_url'] = wu
