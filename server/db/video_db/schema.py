"""テーブルの作成と移行（init_db）"""

from .schema_library import _LibraryTablesMixin
from .schema_video_columns import _VideoColumnsMixin, _migration_error


class _SchemaMixin(_LibraryTablesMixin, _VideoColumnsMixin):
    """VideoDB の一部（テーブルの作成と移行（init_db））。"""

    def init_db(self):
        conn = self._get_conn()
        self._create_library_tables(conn)
        self._migrate_video_columns(conn)
        self._create_video_indexes(conn)
        self._backfill_allow_duplicate(conn)
        self._create_misc_tables(conn)
        conn.commit()


    def _create_misc_tables(self, conn):
        """カテゴリの割り当て・キャプチャの表と、一覧を速くする索引。"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS category_nodes (
                id          INTEGER PRIMARY KEY,
                category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                node_type   TEXT NOT NULL,
                node_id     INTEGER NOT NULL,
                UNIQUE(category_id, node_type, node_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cn_node ON category_nodes(node_type, node_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS captures (
                id                INTEGER PRIMARY KEY,
                video_id          INTEGER REFERENCES videos(id) ON DELETE SET NULL,
                path              TEXT NOT NULL UNIQUE,
                tot               TEXT,
                onid              INTEGER,
                tsid              INTEGER,
                sid               INTEGER,
                eid               INTEGER,
                eit_title         TEXT,
                eit_description   TEXT,
                eit_extended_info TEXT,
                eit_start_time    TEXT,
                eit_end_time      TEXT,
                eit_station_name  TEXT,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_captures_video ON captures(video_id)")
        # アルバム一覧(get_albums)高速化: videos は comments_json 等の巨大JSON列を持ち、
        # 行アクセス自体が重い(オーバーフローページ)。集計に使う列を全て含む
        # カバリングインデックスで行本体へのアクセスを回避する(実測 16.6s → 0.01s)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_series_album ON series(album_id)")
        # media_kind も含める: 音楽と動画を分けてからは一覧が media_kind で絞るため、
        # 含まれていないと行本体を読みに行って一気に遅くなる(実測 0.01s → 1.9s)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_music_key ON videos(music_key)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_series_kind_cov ON videos("
                     "series_id, media_kind, created_at, updated_at, eit_start_time, eit_genre)")
        # 旧インデックス(media_kind 無し)は上のもので賄えるので落とす
        conn.execute("DROP INDEX IF EXISTS idx_videos_series_cov")
        conn.execute("DROP INDEX IF EXISTS idx_videos_series_kind")
        # find_by_broadcast は onid/sid/eit_start_time の等値3条件で絞り、残りは索引で絞られた
        # 少数行(同一放送の話数分割で最大14行)に適用する。索引が無いと18,175行のフルスキャン
        # (実測 0.07秒、cold 0.345秒 → 索引ありで 0.00x秒)。
        conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_broadcast ON videos(onid, sid, eit_start_time)")
        # captures テーブルへのカラム追加マイグレーション（series と同じ方式）。
        # エンコード前の録画(rules.db側のrecordings.id、video.dbとは別DBのため素の整数のみ保持)
        # 再生中に撮ったキャプチャは video_id が未確定なのでここに一時的に紐付けておき、
        # エンコード完了時(run_file_copy)に video_id へ張り替える。
        try:
            conn.execute('ALTER TABLE captures ADD COLUMN recording_id INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        # 持ち主（アカウントごとに見せる。api/stream_routes/capture_owner.py）。前からある物は空＝管理者だけ
        try:
            conn.execute('ALTER TABLE captures ADD COLUMN owner TEXT')
        except Exception as e:
            _migration_error(e)
