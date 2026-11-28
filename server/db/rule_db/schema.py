"""テーブルの作成と移行（init_db）と行の変換"""

import json
from .common import (  # noqa: F401
    _LIST_COLS,
    _to_list,
)
from .schema_recordings import _RecordingTablesMixin
from .schema_columns import _ColumnMigrationsMixin
from .schema_encodings import _EncodingTablesMixin


class _SchemaMixin(_RecordingTablesMixin, _ColumnMigrationsMixin, _EncodingTablesMixin):
    """ProgramDB の一部（テーブルの作成と移行（init_db）と行の変換）。"""

    def init_db(self):
        conn = self._get_conn()
        self._create_programs_recordings(conn)
        self._migrate_recordings_columns(conn)
        self._migrate_programs_columns(conn)
        self._drop_old_columns(conn)
        self._create_encodings(conn)
        self._migrate_states(conn)
        self._create_misc_tables(conn)
        conn.commit()

    def _row_to_dict(self, row) -> dict:
        d = dict(row)
        if d.get('text_parser_result'):
            try:
                d['text_parser_result'] = json.loads(d['text_parser_result'])
            except (json.JSONDecodeError, TypeError):
                pass
        if d.get('drop_error'):
            try:
                d['drop_error'] = json.loads(d['drop_error'])
            except (json.JSONDecodeError, TypeError):
                pass
        # parser_error: JSON 配列文字列 → list
        if d.get('parser_error'):
            try:
                d['parser_error'] = json.loads(d['parser_error'])
            except (json.JSONDecodeError, TypeError):
                pass
        else:
            d['parser_error'] = []
        # リスト列: JSON 配列文字列 → list / 旧スカラーは単要素 list にラップ
        for col in _LIST_COLS:
            if col in d and d[col] is not None:
                d[col] = _to_list(d[col])
        return d
