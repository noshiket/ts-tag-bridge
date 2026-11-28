"""TextParser の本体。メソッドは機能ごとに mixin へ分けてある。"""

import json
import re
from typing import Dict, Any
from ..fetchers.core import ShoboiInfoFetcher
from .config import _ConfigMixin
from .matching import _MatchingMixin
from .resolve import _ResolveMixin
from .analyze import _AnalyzeMixin
from .sub_analyze import _SubAnalyzeMixin
from .regex import _RegexMixin
from .numbers import _NumbersMixin


class TextParser(_ConfigMixin, _MatchingMixin, _ResolveMixin, _AnalyzeMixin, _SubAnalyzeMixin, _RegexMixin, _NumbersMixin):
    _COMBINE_FIELDS = {'episode_name', 'episode_number'}
    # 遅延解決マーカー(未解決のAPIプレースホルダー)判定キー
    _MARKER_KEYS = ('_getEpisodeFromSid', '_getShoboiSubtitle', '_getShoboiEpisode',
                    '_getFromSid', '_getFromTitleAndEpisode', '_fetchText', '_addList', '_setPath')

    # 結合順序を記録する内部キー(処理終了時に除去)。field -> [(order, value), ...]
    _COMBINE_ORDER_KEY = '__combine_order__'

    @classmethod
    def _is_deferred_marker(cls, v) -> bool:
        return isinstance(v, dict) and any(k in v for k in cls._MARKER_KEYS)

    @classmethod
    def _set_or_combine(cls, result: dict, field: str, value, order: int):
        """フィールドへ値をセットする。episode_name/episode_number は複数回セットされたら
        上書きせず analyze リストの呼び出し順(order)でリスト結合する(重複そのまま)。
        order は sync アクションはリスト位置、遅延マーカーは生成時に付与した _order を使う。
        これにより setStr → getShoboiSubtitle のような順序も正しく後付けされる。"""
        if field not in cls._COMBINE_FIELDS:
            result[field] = value
            return
        segs = result.setdefault(cls._COMBINE_ORDER_KEY, {}).setdefault(field, [])
        segs.append((order, value))
        if len(segs) == 1:
            result[field] = value  # 単独寄与は元の型(スカラー/リスト)をそのまま保持
        else:
            flat = []
            for _o, val in sorted(segs, key=lambda t: t[0]):
                flat.extend(val if isinstance(val, list) else [val])
            result[field] = flat

    @classmethod
    def _finalize_combine(cls, result: dict):
        """結合順序の内部キーを除去する(出力へ漏らさない)。"""
        result.pop(cls._COMBINE_ORDER_KEY, None)

    # 漢数字マッピング
    KANJI_TO_NUM = {
        '零': 0, '〇': 0, 'ゼロ': 0,
        '一': 1, '壱': 1, 'いち': 1, '壹': 1,
        '二': 2, '弐': 2, 'に': 2, '貮': 2, '貳': 2,
        '三': 3, '参': 3, 'さん': 3, '參': 3,
        '四': 4, '肆': 4, 'よん': 4, 'し': 4,
        '五': 5, '伍': 5, 'ご': 5,
        '六': 6, 'ろく': 6, '陸': 6,
        '七': 7, '漆': 7, 'なな': 7, 'しち': 7, '柒': 7,
        '八': 8, 'はち': 8, '捌': 8,
        '九': 9, 'きゅう': 9, 'く': 9, '玖': 9,
        '十': 10, '拾': 10, 'じゅう': 10,
    }
    
    # 英語数字マッピング
    ENGLISH_TO_NUM = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
        'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
        'eighteen': 18, 'nineteen': 19, 'twenty': 20,
        'thirty': 30, 'forty': 40, 'fifty': 50,
        'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
        'hundred': 100
    }
    
    # ------------------------------------------------------------------
    # アクションスキーマ定義（UI 向け静的メタデータ）
    # text_parser.py 側で管理し、新しいアクションを追加したらここも更新する
    # ------------------------------------------------------------------
    OUTPUT_FIELDS = [
        {"key": "title",          "label": "タイトル",     "type": "string"},
        {"key": "episode_number", "label": "話数",         "type": "number"},
        {"key": "episode_name",   "label": "サブタイトル", "type": "string"},
        {"key": "folder",         "label": "フォルダ名",   "type": "string"},
        {"key": "furigana",       "label": "ふりがな",     "type": "string"},
        {"key": "category",       "label": "カテゴリ",     "type": "array<string>"},
        {"key": "auto_send",      "label": "自動送信",     "type": "boolean"},
        {"key": "app_output_path","label": "出力パス",     "type": "string"},
    ]

    ANALYZE_ACTION_SCHEMA = [
        {
            "key": "setStr", "label": "文字列セット",
            "description": "フィールドに文字列をセット。{$1} 形式のプレースホルダー使用可。from/to 指定で置換可",
            "output_type": "string",
            "default_field": "title",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "title"},
                {"key": "str", "label": "値", "type": "template_string", "required": True,
                 "description": "{$N} 形式でキャプチャグループ、$varname でコンテキスト参照"},
                {"key": "from", "label": "置換元(正規表現)", "type": "string", "required": False,
                 "description": "指定すると生成した値に対し正規表現置換を行う(re.sub)"},
                {"key": "to", "label": "置換後", "type": "string", "required": False,
                 "default": "", "description": "from にマッチした箇所の置換後文字列(\\1 で後方参照)"},
            ],
        },
        {
            "key": "setNum", "label": "数値セット",
            "description": "文字列を数値に変換してセット（漢数字・英語数字対応）",
            "output_type": "number",
            "default_field": "episode_number",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "episode_number"},
                {"key": "str", "label": "値", "type": "template_string", "required": True},
            ],
        },
        {
            "key": "setSubtitles", "label": "サブタイトルリスト",
            "description": "区切り文字でサブタイトルリスト（配列）に変換してセット",
            "output_type": "array<string>",
            "default_field": "episode_name",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "episode_name"},
                {"key": "str", "label": "値", "type": "template_string", "required": True},
                {"key": "separator", "label": "区切り文字", "type": "string", "required": False, "default": "#"},
            ],
        },
        {
            "key": "addList", "label": "リストに追加",
            "description": "フィールドのリストに文字列を追加。リストがなければ新規作成",
            "output_type": "array<string>",
            "default_field": "category",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "category", "description": "category など"},
                {"key": "str", "label": "値", "type": "template_string", "required": True,
                 "description": "{$N} 形式でキャプチャグループ、$varname でコンテキスト参照"},
            ],
        },
        {
            "key": "setPath", "label": "出力パス生成",
            "description": "他の出力フィールドが揃った後にパステンプレートを展開して設定。"
                           "出力フィールドがリストなら zip して複数パスを生成。"
                           "{$encode_dir}/{$ext} 等は context 変数（即時解決）、{$title}/{$episode_number} 等は出力フィールド参照（遅延解決）",
            "output_type": "string | array<string>",
            "default_field": "app_output_path",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "app_output_path", "description": "app_output_path など"},
                {"key": "str", "label": "パステンプレート", "type": "template_string", "required": True,
                 "description": "{$varname} 形式推奨。{$encode_dir}/{$folder}/[{$sid}]{$title}_{$episode_number}_{$start_time}{$ext} など"},
            ],
        },
        {
            "key": "getEpisodeFromSid", "label": "話数取得（SID）",
            "description": "SIDと放送日時からしょぼいカレンダーで話数を取得",
            "output_type": "number",
            "default_field": "episode_number",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "episode_number"},
                {"key": "sid", "label": "SID", "type": "context_ref_or_number", "required": False,
                 "default": "$sid",
                 "description": "省略時はコンテキストの sid を自動使用。$sid と書いてもよい"},
                {"key": "startTimeField", "label": "放送日時フィールド名", "type": "string",
                 "required": False, "default": "$start_time"},
            ],
        },
        {
            "key": "getShoboiSubtitle", "label": "サブタイトル取得（TID）",
            "description": "TIDと話数フィールドからしょぼいカレンダーでサブタイトルを取得",
            "output_type": "string",
            "default_field": "episode_name",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "episode_name"},
                {"key": "tid", "label": "TID（しょぼいカレタイトルID）", "type": "string", "required": True},
                {"key": "episodeField", "label": "話数フィールド名", "type": "field_ref",
                 "required": False, "default": "episode"},
            ],
        },
        {
            "key": "getShoboiEpisode", "label": "話数逆引き（サブタイトル→話数）",
            "description": "サブタイトル文字列からしょぼいカレンダーで話数を逆引き",
            "output_type": "number",
            "default_field": "episode_number",
            "params": [
                {"key": "field", "label": "出力フィールド名", "type": "field_ref", "required": True,
                 "default": "episode_number"},
                {"key": "tid", "label": "TID（しょぼいカレタイトルID）", "type": "string", "required": True},
                {"key": "subtitleField", "label": "サブタイトルフィールド名", "type": "field_ref",
                 "required": False, "default": "subtitle"},
            ],
        },
        {
            "key": "getFromSid", "label": "一括取得（SID）",
            "description": "SIDと放送日時からしょぼいカレの複数フィールドを一括取得してフィールドにマップ",
            "output_type": "mapped_fields",
            "params": [
                {"key": "sid", "label": "SID", "type": "context_ref_or_number", "required": False,
                 "default": "$sid",
                 "description": "省略時はコンテキストの sid を自動使用"},
                {"key": "startTimeField", "label": "放送日時フィールド名", "type": "string",
                 "required": False, "default": "$start_time"},
                {"key": "set", "label": "フィールドマッピング", "type": "source_to_dest_map", "required": True,
                 "default": {"sid-episode_name": "episode_name", "sid-episode_number": "episode_number",
                             "sid-furigana": "furigana", "sid-short_title": "title", "sid-wiki_title": "folder"},
                 "description": "取得元キー → セット先フィールド名 の辞書",
                 "available_sources": [
                     {"key": "sid-episode_number", "description": "話数"},
                     {"key": "sid-episode_name",   "description": "サブタイトル"},
                     {"key": "sid-title",          "description": "作品タイトル"},
                     {"key": "sid-short_title",    "description": "タイトル略称"},
                     {"key": "sid-furigana",       "description": "タイトル読み仮名"},
                     {"key": "sid-tid",            "description": "しょぼいカレ タイトルID"},
                     {"key": "sid-pid",            "description": "しょぼいカレ 番組ID"},
                     {"key": "sid-wiki_title",     "description": "Wikiタイトル"},
                     {"key": "sid-announce",       "description": "放送異常・告知情報"},
                 ]},
            ],
        },
        {
            "key": "switch", "label": "条件分岐",
            "description": "キャプチャグループの値で分岐し、マッチしたブランチの analyze を実行",
            "output_type": "depends_on_branch",
            "params": [
                {"key": "switch", "label": "分岐対象", "type": "placeholder_ref", "required": True,
                 "description": "{$N} 形式。そのグループの値で list 内の str と照合する"},
                {"key": "list", "label": "分岐リスト", "type": "array<{ str, analyze[] }>", "required": True,
                 "description": "str が一致したブランチの analyze を実行"},
                {"key": "else", "label": "デフォルトブランチ", "type": "array<analyze>", "required": False,
                 "description": "list 内のいずれにも一致しなかった場合に実行。実行された場合は出力フィールドに \"else\": \"true\" が追加される"},
            ],
        },
        {
            "key": "pattern", "label": "入れ子パターン解析",
            "description": "別フィールド・コンテキスト変数のテキストに対して再帰的にパターンマッチを実行",
            "output_type": "depends_on_nested_analyze",
            "params": [
                {"key": "pattern", "label": "パターン", "type": "template_string", "required": True,
                 "description": "{$N} 形式のプレースホルダーを含む正規表現テンプレート"},
                {"key": "text", "label": "解析対象テキスト変数", "type": "context_ref", "required": False,
                 "default": "$title",
                 "description": "$varname 形式でコンテキスト変数を指定（例: $description）。省略時は $title"},
                {"key": "pattern2", "label": "AND条件パターン", "type": "template_string", "required": False,
                 "description": "[実験的] このパターンも同時にマッチした場合のみ analyze を実行。text2 も必須"},
                {"key": "text2", "label": "AND条件のテキスト変数", "type": "context_ref", "required": False,
                 "description": "pattern2 を指定した場合は必須。キャプチャグループは {$N+offset} で参照（pattern のグループ数分ずれる）"},
                {"key": "analyze", "label": "ネスト内アクション", "type": "array<analyze>", "required": True,
                 "description": "マッチ後に実行するアクション。{$N} は pattern のグループ、{$N+offset} は pattern2 のグループを参照"},
            ],
        },
        {
            "key": "getFromTitleAndEpisode", "label": "一括取得（タイトル＋話数）",
            "description": "タイトル文字列と話数からしょぼいカレの情報を取得してフィールドにマップ",
            "output_type": "mapped_fields",
            "params": [
                {"key": "title", "label": "タイトル", "type": "template_string", "required": True,
                 "default": "{$1}",
                 "description": "{$N} 形式のプレースホルダー使用可"},
                {"key": "episode", "label": "話数（直接指定）", "type": "template_string", "required": False,
                 "description": "episodeField と排他。直接値を書く場合に使用"},
                {"key": "episodeField", "label": "話数フィールド名", "type": "field_ref", "required": False,
                 "default": "episode_number",
                 "description": "他のアクティブが出力した話数フィールドを参照する場合に使用"},
                {"key": "fetch_wiki", "label": "Wikiタイトルを取得", "type": "boolean", "required": False,
                 "default": False,
                 "description": "set に t-wiki_title または wiki_title を含む場合は自動的に true になる"},
                {"key": "set", "label": "フィールドマッピング", "type": "source_to_dest_map", "required": True,
                 "default": {"t-short_title": "title", "t-furigana": "furigana", "t-episode_name": "episode_name", "t-wiki_title": "folder"},
                 "available_sources": [
                     {"key": "t-title",        "description": "作品タイトル（正規化済み）"},
                     {"key": "t-short_title",  "description": "タイトル略称"},
                     {"key": "t-furigana",     "description": "タイトル読み仮名"},
                     {"key": "t-episode_name", "description": "サブタイトル"},
                     {"key": "t-tid",          "description": "しょぼいカレ タイトルID"},
                     {"key": "t-wiki_title",   "description": "Wikiタイトル"},
                 ]},
            ],
        },
    ]

    def __init__(self, config_path: str):
        """
        テキスト解析クラスの初期化

        Args:
            config_path: JSON設定ファイルのパス
        """
        self.config_path = config_path
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        self.analyzers = self.config.get('analyzers', [])
        self._fetcher = None

    def _get_fetcher(self) -> 'ShoboiInfoFetcher':
        if self._fetcher is None:
            self._fetcher = ShoboiInfoFetcher()
        return self._fetcher

    @staticmethod
    def _analyzer_priority(analyzer: Dict[str, Any]) -> tuple:
        """
        アナライザーの優先度キーを返す（小さいほど優先）
        優先順位:
          1. switch があるもの > switch がないもの
          2. パターン内の固定文字数（{$N} 以外の文字）が多いもの
          3. {$N} グループ数が多いもの
          4. pattern2（AND条件）があるもの > ないもの
          5. pattern2 同士では、pattern2 の固定文字数が多いもの → グループ数が多いもの
        ※ else の有無は優先順位に影響しない（parse_text の2パスで制御）
        """
        pattern = analyzer.get('pattern', '')
        analyze_items = analyzer.get('analyze', [])
        has_switch = any('switch' in item for item in analyze_items)
        group_count = len(re.findall(r'\{\$\d+\}', pattern))
        fixed_chars = len(re.sub(r'\{\$\d+\}', '', pattern))
        pattern2 = analyzer.get('pattern2') or ''
        p2_groups = len(re.findall(r'\{\$\d+\}', pattern2))
        p2_fixed = len(re.sub(r'\{\$\d+\}', '', pattern2))
        # else の有無は優先順位に影響しない（マッチ時の2パスで制御する）
        # pattern2 があるもの（AND条件）は同じ title パターンより優先。pattern2 同士は細かい方を先に
        switch_priority = 0 if has_switch else 1
        p2_priority = 0 if pattern2 else 1
        return (switch_priority, -fixed_chars, -group_count, p2_priority, -p2_fixed, -p2_groups)
