"""encodings とその他のテーブルを作る・状態の値の移行（init_db の一部）"""

from .schema_columns import _migration_error


class _EncodingTablesMixin:
    """encodings とその他のテーブルを作る・状態の値の移行（init_db の一部）"""

    def _create_encodings(self, conn):
        """エンコード(encodings)の表と、後から足した列・名前を変えた列・消した列。"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS encodings (
                id                 INTEGER PRIMARY KEY,
                recording_id       INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
                order_index        INTEGER NOT NULL DEFAULT 0,
                episode_number     TEXT,
                episode_name       TEXT,
                state              TEXT NOT NULL DEFAULT 'wait_encode',
                error_message      TEXT,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL DEFAULT ''
            )
        """)
        # encodings テーブルへのカラム追加マイグレーション
        for col_def in (
            "encode_info TEXT",
            "tag_json TEXT",
            "title TEXT",
            "folder TEXT",
            "category TEXT",
            "furigana TEXT",
            "drop_error TEXT",
            "sid INTEGER",
            "eit_start_time TEXT",
            "eit_end_time TEXT",
            "comments_json TEXT",
            "captions_json TEXT",
            "captions2_json TEXT",
            "trim_segments TEXT",
            "recording_start_time TEXT",
            "recording_end_time TEXT",
            "segments TEXT",
            "app_output_path TEXT",
            "encode_dir TEXT",
            "episode_idx INTEGER DEFAULT 0",
            "episode_count INTEGER",
            "comment_count INTEGER",
            "progress REAL DEFAULT 0",
            # エンコード優先度(1-5、既定3)。エンコードの実行は高い順→id昇順でディスパッチする
            "priority INTEGER NOT NULL DEFAULT 3",
            # エンコードを始めた時刻（時差付き ISO）。実行中の残り時間の計算用
            "encoding_started_at TEXT",
            "analyzed_comments_json TEXT",
            "analyzed_captions_json TEXT",
            "analyzed_captions2_json TEXT",
            "analyzed_drop_error TEXT",
            "analyzed_recording_start_time TEXT",
            "analyzed_recording_end_time TEXT",
            "analyzed_comment_count INTEGER",
            "app_output_path_format TEXT",
            "recording_device TEXT",
            "video_info TEXT",
            "audio_info TEXT",
            "file_size INTEGER",
            "duration_sec REAL",
            "chapter_txt TEXT",
            "thumbnail_path TEXT",
            "thumbnail_tile_path TEXT",
            "thumbnail_info TEXT",
            "key_frames TEXT",
            # コマ送り用のフレーム表(表示時刻の一覧)。H.264/H.265 は自前パーサが
            # 使えないため ffprobe で作る。キーフレームだけの key_frames とは別物。
            "frame_table TEXT",
            # 仕事の種類。空/'encode' が従来の「録画をエンコードする」。
            # 'video_addon' は video.db の動画にアドオンを掛ける仕事
            # （動画の形式を変えるアドオンの HEVC 変換など）。
            #
            # encode_type とは別の軸にする。あちらは「録画をどのエンコーダーで
            # 処理するか」の指定で、MP4→MP4 の変換はそこに属さない。
            #
            # 同じ待ち行列に載せるのは、どちらも QSV を長時間使うため。別々に
            # 走らせると食い合う（実測: あるエンコードが90%の最中に
            # 動画の形式を変えるアドオンが始まった）。エンコードの実行は1件ずつ処理するので、
            # 同じ行列に入れれば順番・一時停止・進捗の仕組みがそのまま効く。
            "job_kind TEXT",
            # video_addon の対象。video.db の videos.id
            "video_id INTEGER",
            # video_addon で動かすアドオン名と、その引数(JSON)
            "addon_name TEXT",
            "addon_params TEXT",
        ):
            try:
                conn.execute(f'ALTER TABLE encodings ADD COLUMN {col_def}')
            except Exception as e:
                _migration_error(e)
        # encodings カラムリネームマイグレーション（amatsukaze_trim_segments → trim_segments）
        _enc_cols = [r[1] for r in conn.execute('PRAGMA table_info(encodings)').fetchall()]
        if 'amatsukaze_trim_segments' in _enc_cols:
            if 'trim_segments' in _enc_cols:
                conn.execute('ALTER TABLE encodings DROP COLUMN trim_segments')
            conn.execute('ALTER TABLE encodings RENAME COLUMN amatsukaze_trim_segments TO trim_segments')
        # encodings 旧カラム削除マイグレーション
        # 注: 'priority' は旧システムの同名列を一度削除していたが、エンコード優先度
        # (1-5、既定3)として再導入したため削除リストから除外している
        for col in (
            'start_offset', 'end_offset', 'source_ts_path',
            'input_path', 'output_path', 'tmp_dir',
            'profile', 'encode_start_time', 'encode_end_time',
        ):
            try:
                conn.execute(f'ALTER TABLE encodings DROP COLUMN {col}')
            except Exception as e:
                _migration_error(e)

    def _migrate_states(self, conn):
        """状態の名前の移行（skipped/found/scanning/running などの旧い名前）。"""
        # skipped 廃止マイグレーション: 旧 skipped → pending
        conn.execute("UPDATE programs SET state='pending' WHERE state='skipped'")
        # found 廃止マイグレーション: 旧 found → scanning
        conn.execute("UPDATE recordings SET state='scanning' WHERE state='found'")
        # scanning → pending リネームマイグレーション: 処理中(scanning)と処理待ち(pending)を分離
        conn.execute("UPDATE recordings SET state='pending' WHERE state='scanning'")
        # auto_add_id カラム追加マイグレーション
        try:
            conn.execute("ALTER TABLE programs ADD COLUMN auto_add_id INTEGER")
        except Exception as e:
            _migration_error(e)  # already exists
        # encodings state マイグレーション: 旧 state → 新 state
        conn.execute("UPDATE encodings SET state='encoding' WHERE state='running'")
        conn.execute("UPDATE encodings SET state='encoding' WHERE state='amz_queued'")
        conn.execute("UPDATE encodings SET state='encoded_analyze' WHERE state='amz_done'")
        conn.execute("UPDATE encodings SET state='file_copy' WHERE state='copy_error'")

    def _create_misc_tables(self, conn):
        """記録しない録画・外付けディスク・自動エンコードのルールの表。"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ignored_rec_ids (
                rec_id INTEGER PRIMARY KEY
            )
        """)
        # 外部ディスク（取り外し検知）レジストリ
        conn.execute("""
            CREATE TABLE IF NOT EXISTS disks (
                mount_point TEXT PRIMARY KEY,
                disk_id     TEXT,
                is_external INTEGER NOT NULL DEFAULT 0,
                updated_at  TEXT NOT NULL DEFAULT ''
            )
        """)
        # auto_encode（確定値マッチで recordings.auto_send=true にする自動エンコードルール）
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auto_encode (
                id                     INTEGER PRIMARY KEY,
                folder                 TEXT,
                title                  TEXT,
                sid                    INTEGER,
                use_folder             INTEGER NOT NULL DEFAULT 0,
                use_title              INTEGER NOT NULL DEFAULT 0,
                use_sid                INTEGER NOT NULL DEFAULT 0,
                require_episode_name   INTEGER NOT NULL DEFAULT 0,
                require_episode_number INTEGER NOT NULL DEFAULT 0,
                allow_multi_episode    INTEGER NOT NULL DEFAULT 0,
                enabled                INTEGER NOT NULL DEFAULT 1,
                created_at             TEXT NOT NULL,
                updated_at             TEXT NOT NULL
            )
        """)
