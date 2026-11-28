"""TextParserStore — SID ごとの text_parser 設定ファイルを管理する。

ファイル名規則: {data_dir}/SID{sid}-tp.json
"""

import os
import re
import json


class TextParserStore:
    """SID ごとの TextParser を data_dir/SID{sid}-tp.json から読み書きする。

    get_parser() はインスタンスをメモリキャッシュする。
    API 経由の save() はキャッシュ内オブジェクトに反映されるため、
    ファイルを外部から直接変更した場合は invalidate() を呼ぶこと。
    """

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self._cache: dict[int, object] = {}  # sid -> TextParser

    def _path(self, sid: int) -> str:
        return os.path.join(self.data_dir, f'SID{sid}-tp.json')

    def list_sids(self) -> list[int]:
        """data_dir 内の SID{n}-tp.json から SID 一覧を返す。"""
        if not os.path.isdir(self.data_dir):
            return []
        result = []
        for name in os.listdir(self.data_dir):
            m = re.match(r'^SID(\d+)-tp\.json$', name)
            if m:
                result.append(int(m.group(1)))
        return sorted(result)

    def get_parser(self, sid: int):
        """SID に対応する TextParser を返す。ファイルが存在しない場合は None。"""
        if sid in self._cache:
            return self._cache[sid]
        path = self._path(sid)
        if not os.path.exists(path):
            return None
        from text_parser.parser.core import TextParser
        parser = TextParser(path)
        self._cache[sid] = parser
        return parser

    def get_or_create_parser(self, sid: int):
        """SID に対応する TextParser を返す。ファイルが存在しない場合は空で新規作成する。"""
        p = self.get_parser(sid)
        if p is not None:
            return p
        os.makedirs(self.data_dir, exist_ok=True)
        path = self._path(sid)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'analyzers': []}, f, ensure_ascii=False, indent=2)
        from text_parser.parser.core import TextParser
        parser = TextParser(path)
        self._cache[sid] = parser
        return parser

    def invalidate(self, sid: int):
        """指定 SID のキャッシュを破棄する（外部ファイル変更後に使用）。"""
        self._cache.pop(sid, None)
