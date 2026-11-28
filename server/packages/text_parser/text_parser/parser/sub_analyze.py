"""入れ子の analyze（switch・pattern）"""

import re
from typing import Dict, List, Any, Optional
from .. import actions as parser_actions


_GROUP_REF = re.compile(r'\{\$(\d+)\}')


def _fill_groups(text, groups):
    """{$N} を N 番目のグループ(gN)の値にする。無いグループは空文字。"""
    return _GROUP_REF.sub(lambda m: groups.get(f"g{m.group(1)}", ''), text)


def _fill_groups_keep(expr, groups):
    """{$N} を N 番目のグループ(gN)の値にする。無いグループは {$N} のまま残す（後で解決する）。"""
    if not expr:
        return expr
    return _GROUP_REF.sub(lambda m: groups.get(f"g{m.group(1)}", m.group(0)), str(expr))


class _SubAnalyzeMixin:
    """TextParser の一部（入れ子の analyze（switch・pattern））。"""

    def _process_sub_analyze(self, config: Dict[str, Any],
                            matched_groups: Dict[str, str],
                            context: Optional[Dict[str, Any]] = None,
                            _errors: Optional[List[str]] = None,
                            _path: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
        """
        サブanalyze設定を処理

        Args:
            config: サブanalyze設定
            matched_groups: マッチしたグループの値

        Returns:
            フィールド名と値の辞書
        """
        result = {}
        # アドオンアクションには 'g1' ではなく '1' の形で渡す(UI の {$1} と同じ見え方)
        matched_groups_plain = {k[1:]: v for k, v in (matched_groups or {}).items()
                                if k.startswith('g')}

        # setStr: 文字列を直接設定
        if 'setStr' in config:
            field_name = config['setStr']
            str_value = config.get('str', '')

            # {$N}形式を置換
            str_value = _fill_groups(str_value, matched_groups)
            # $varname形式のコンテキスト参照を解決
            str_value = self._resolve_context_refs(str_value, context)
            # from/to 指定があれば生成値に対し正規表現置換(例: from='劇場版' to='' で除去)
            _from = config.get('from')
            if _from:
                try:
                    str_value = re.sub(_from, config.get('to', ''), str_value)
                except re.error as e:
                    print(f"[setStr] 置換パターン不正 from={_from!r}: {e}")
            result[field_name] = str_value

        # setNum: 数値に変換して設定
        elif 'setNum' in config:
            field_name = config['setNum']
            str_value = config.get('str', '')

            # {$N}形式を置換
            str_value = _fill_groups(str_value, matched_groups)
            # $varname形式のコンテキスト参照を解決
            str_value = self._resolve_context_refs(str_value, context)
            num_value = self._convert_to_number(str_value)
            result[field_name] = num_value
            if _errors is not None:
                _raw = str_value.strip().lstrip('#＃').strip()
                if not _raw or re.search(r'\$[a-zA-Z_]\w*', _raw):
                    _errors.append('>'.join((_path or []) + ['setNum']) + ':' + field_name)

        # setSubtitles: 「01 タイトル#02 タイトル」形式をリストに変換
        elif 'setSubtitles' in config:
            field_name = config['setSubtitles']
            str_value = config.get('str', '')
            separator = config.get('separator', '#')

            str_value = _fill_groups(str_value, matched_groups)
            str_value = self._resolve_context_refs(str_value, context)
            result[field_name] = self._convert_to_subtitles(str_value, separator)

        # getEpisodeFromSid: SIDと放送日時から話数を取得
        elif 'getEpisodeFromSid' in config:
            field_name = config['getEpisodeFromSid']
            sid = config.get('sid')
            start_time_field = config.get('startTimeField', 'start_time')

            # プレースホルダーとして保存し、後で解決する
            result[field_name] = {
                '_getEpisodeFromSid': True,
                'sid': sid,
                'startTimeField': start_time_field
            }

        # getShoboiSubtitle: しょぼいカレンダーAPIからサブタイトルを取得
        elif 'getShoboiSubtitle' in config:
            field_name = config['getShoboiSubtitle']
            tid = config.get('tid', '')
            episode_field = config.get('episodeField', '')

            # プレースホルダーとして保存し、後で解決する
            result[field_name] = {
                '_getShoboiSubtitle': True,
                'tid': tid,
                'episodeField': episode_field
            }

        # getShoboiEpisode: サブタイトル文字列からしょぼいカレンダーで話数を逆引き
        elif 'getShoboiEpisode' in config:
            field_name = config['getShoboiEpisode']
            tid = config.get('tid', '')
            subtitle_field = config.get('subtitleField', '')

            # プレースホルダーとして保存し、4パス目でsubtitleFieldの値を使って解決する
            result[field_name] = {
                '_getShoboiEpisode': True,
                'tid': tid,
                'subtitleField': subtitle_field
            }

        # getFromSid: SIDと放送日時からしょぼいカレンダーの複数フィールドを一括取得
        elif 'getFromSid' in config:
            field_name = config['getFromSid']
            result[field_name] = {
                '_getFromSid': True,
                'sid': config.get('sid'),
                'startTimeField': config.get('startTimeField', 'start_time'),
                'set': config.get('set', {}),
            }

        # 文字を取ってくるアクション（アドオンの fetch_text。例: 配信サイトの副題を取ってネスト解析）
        elif (fetch_key := parser_actions.fetch_text_key(config)):
            # textField の {$N} はこのスコープの matched_groups で即時解決する
            # ネストの pattern/analyze は生のまま載せ、文字を取ってきた後（遅延）に解決する。
            # 専用キー __fetchText__ に格納（出力フィールドではない。1解析につき1つ想定）。
            result['__fetchText__'] = {
                '_fetchText': True,
                'key': fetch_key,
                'sid': config.get('sid'),
                'startTimeField': config.get('startTimeField', 'start_time'),
                'textField': _fill_groups_keep(config.get('textField', '$title'), matched_groups),
                'pattern': config.get('pattern', ''),
                'analyze': config.get('analyze', []),
            }

        # getFromTitleAndEpisode: タイトルと話数からしょぼいカレンダーの情報を取得
        elif 'getFromTitleAndEpisode' in config:
            field_name = config['getFromTitleAndEpisode']

            # {$N} を matched_groups で即時解決
            result[field_name] = {
                '_getFromTitleAndEpisode': True,
                'title': _fill_groups_keep(config.get('title', ''), matched_groups),
                'episode': _fill_groups_keep(config.get('episode', ''), matched_groups),
                'episodeField': config.get('episodeField', ''),
                'fetch_wiki': config.get('fetch_wiki', False),
                'set': config.get('set', {}),
            }

        # addList: リストに文字列を追加（リストがなければ新規作成）
        elif 'addList' in config:
            field_name = config['addList']
            str_value = config.get('str', '')

            str_value = _fill_groups(str_value, matched_groups)
            # {$varname} は _resolve_deferred 後にポスト処理で解決（出力フィールドが揃ってから）
            result[field_name] = {'_addList': True, 'template': str_value}

        # setPath: 他の出力フィールドが揃った後に展開するパス生成（_process_analyze_list でポスト処理）
        elif 'setPath' in config:
            field_name = config['setPath']
            str_value = config.get('str', '')

            # {$N} → matched_groups で即時解決。{$varname} は全て _resolve_set_path に委ねる
            str_value = _fill_groups(str_value, matched_groups)
            result[field_name] = {'_setPath': True, 'template': str_value}

        # アドオンが追加したアクション(server/addon/ の target='parser_action')。
        # 組み込みに一致しなかった時だけ見るので、既存の挙動は変わらない。
        else:
            key = next((k for k in config
                        if isinstance(k, str) and parser_actions.find(k) is not None), None)
            if key:
                action = parser_actions.find(key)
                field_name = config.get('field') or config[key] or action['default_field']
                if action['deferred']:
                    # 他の出力フィールドを参照できるよう、全部揃ってから実行する
                    result[field_name] = parser_actions.make_marker(key, config, matched_groups_plain)
                else:
                    value = parser_actions.run(key, config, groups=matched_groups_plain,
                                               context=context)
                    if value is not None:
                        result[field_name] = value

        return result if result else None
