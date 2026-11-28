"""ライブラリの表（アルバム・シリーズ・動画・カテゴリ）と索引を作る（init_db の一部）"""

from .common import _has_drop_or_scramble
from .schema_video_columns import _migration_error


class _LibraryTablesMixin:
    """ライブラリの表（アルバム・シリーズ・動画・カテゴリ）と索引を作る（init_db の一部）"""

    def _create_library_tables(self, conn):
        """カテゴリ・アルバム・シリーズ・動画の表（シリーズに後から足した列も）。"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id         INTEGER PRIMARY KEY,
                name       TEXT NOT NULL UNIQUE,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS albums (
                id          INTEGER PRIMARY KEY,
                name        TEXT NOT NULL UNIQUE,
                description TEXT,
                sort_order  INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS series (
                id         INTEGER PRIMARY KEY,
                album_id   INTEGER REFERENCES albums(id) ON DELETE SET NULL,
                name       TEXT NOT NULL,
                furigana   TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(album_id, name)
            )
        """)
        # series テーブルへのカラム追加マイグレーション（rule_db.py と同じ方式）
        try:
            conn.execute('ALTER TABLE series ADD COLUMN thumbnail_path TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        conn.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                id                     INTEGER PRIMARY KEY,
                series_id              INTEGER REFERENCES series(id) ON DELETE SET NULL,
                file_path              TEXT NOT NULL UNIQUE,
                app_output_path_format TEXT,
                recording_device       TEXT,
                file_size              INTEGER,
                duration_sec           REAL,
                onid                   INTEGER,
                tsid                   INTEGER,
                sid                    INTEGER,
                eid                    INTEGER,
                furigana               TEXT,
                episode_number         TEXT,
                episode_name           TEXT,
                eit_title              TEXT,
                eit_description        TEXT,
                eit_extended_info      TEXT,
                eit_start_time         TEXT,
                eit_end_time           TEXT,
                eit_station_name       TEXT,
                eit_genre              TEXT,
                eit_video_info         TEXT,
                eit_audio_info         TEXT,
                recording_start_time   TEXT,
                recording_end_time     TEXT,
                trim_segments          TEXT,
                drop_error             TEXT,
                text_parser_result     TEXT,
                setting                TEXT,
                edcb_tag               TEXT,
                comments_json          TEXT,
                comment_count          INTEGER,
                captions_json          TEXT,
                captions2_json         TEXT,
                chapter_txt            TEXT,
                thumbnail_path         TEXT,
                thumbnail_tile_path    TEXT,
                thumbnail_info         TEXT,
                sort_order             INTEGER DEFAULT 0,
                created_at             TEXT NOT NULL,
                updated_at             TEXT NOT NULL
            )
        """)

    def _create_video_indexes(self, conn):
        """動画一覧・話数の索引。"""
        try:
            # ビデオ一覧の「追加順」(list_videos sort=added)。索引が無いと
            # 全件を並べ替えてから上位を取ることになり、videos は1行が大きいので
            # 極端に遅い(実測 2.7〜15.8秒 → 索引ありで 0.01秒)。
            conn.execute('CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at)')
        except Exception as e:
            _migration_error(e)
        try:
            # 勢い一覧(get_videos_by_momentum)専用のカバリングインデックス。
            # 行本体に巨大な JSON が入っているため、小さい列しか見ない COUNT(*) でも
            # 全件走査だと行のページを読むことになる(実測 17.3秒)。索引だけで済ませる
            # (実測 0.5ms、EXPLAIN も SEARCH USING COVERING INDEX)。
            conn.execute('''CREATE INDEX IF NOT EXISTS idx_videos_momentum ON videos(
                comment_count, duration_sec, recording_start_time, created_at, id)
                WHERE comment_count > 0 AND duration_sec > 0''')
        except Exception as e:
            _migration_error(e)
        try:
            # 重複索引(list_episode_index)専用のカバリングインデックス。
            # videos は comments_json/captions などを持つため1行が大きく、全件走査だと
            # 行本体のページを読むことになる(実測 12,735本で 1.5秒)。必要な列だけを
            # 索引に入れておくと索引だけで済む(実測 0.05秒、EXPLAIN も
            # SCAN v USING COVERING INDEX)。列の順序と内容は list_episode_index の
            # SELECT と揃えること。
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_videos_epindex ON videos"
                "(series_id, id, episode_number, episode_name, drop_count, scramble_count,"
                " eit_station_name, comment_count, duration_sec, announce, sid)")
            conn.commit()
        except Exception as e:
            _migration_error(e)

    def _backfill_allow_duplicate(self, conn):
        """重複の許可(allow_duplicate)が未設定の行を、ドロップ/スクランブルの状況から埋める。"""
        # 既存動画の backfill: 未設定(NULL)の行を drop/scramble 状況から一括初期化
        try:
            rows = conn.execute(
                "SELECT id, drop_error FROM videos WHERE allow_duplicate IS NULL").fetchall()
            for r in rows:
                conn.execute("UPDATE videos SET allow_duplicate=? WHERE id=?",
                             (1 if _has_drop_or_scramble(r['drop_error']) else 0, r['id']))
            if rows:
                conn.commit()
        except Exception as e:
            _migration_error(e)
