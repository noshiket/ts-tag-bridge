"""videos に後から足した列の移行（init_db の一部）"""

from ..migrations import migration_error
from .common import caption_flag, drop_scramble_counts, logger


def _migration_error(e):
    migration_error(e, logger)


class _VideoColumnsMixin:
    """videos に後から足した列の移行（init_db の一部）"""

    def _migrate_video_columns(self, conn):
        """videos に後から足した列と、その値の埋め戻し。"""
        # videos テーブルへのカラム追加マイグレーション
        try:
            # announce: しょぼいカレンダーの放送異常告知(encoded_analyzeがtag.jsonへ記録)
            conn.execute('ALTER TABLE videos ADD COLUMN announce TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # encode_dir: 保存先指定。'master'はlibrary_peerへの移動予約マークで、
            # VideoPushWorkerがこれを見てサーバー間で自動転送する(tag.jsonと同期)
            conn.execute('ALTER TABLE videos ADD COLUMN encode_dir TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # allow_duplicate: 重複録画の許可(1=この動画と重複する予約を自動スキップしない)。
            # drop/scramble が発生している動画は登録時に自動で 1(撮り直し歓迎)。
            # videoカードの「…」から手動トグル可能
            conn.execute('ALTER TABLE videos ADD COLUMN allow_duplicate INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # captions3_json: 後付け字幕(list形式)。captions_json/captions2_json は TS 由来の
            # 字幕1/字幕2で名前を持てないため、別放送から取り込んだ字幕は名前付きの
            # 複数トラックとしてここに入れる。
            # [{name, source:{video_id,path,recording_start_time}, created_at, captions:[...]}]
            conn.execute('ALTER TABLE videos ADD COLUMN captions3_json TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # has_secondary_audio: 副音声の有無(1/0)。NULL=未判定。
            # 判定に ffprobe(1件あたり ~150ms)が要るため一覧では毎回測らず、登録時に確定させ、
            # 既存行は再生時(metadata取得)に遅延で埋める。
            conn.execute('ALTER TABLE videos ADD COLUMN has_secondary_audio INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # video_codec: 映像コーデック(ffprobe の codec_name)。NULL=未判定。
            # MP4→MPEG-TS 変換(psisimux)に載らないコーデック(AV1/VP9 等)はサーバー配信の
            # HLS 経路に乗らないため、再生方法を分ける判断に使う。has_secondary_audio と
            # 同じく登録時ではなく再生時(metadata取得)に遅延で埋める。
            conn.execute('ALTER TABLE videos ADD COLUMN video_codec TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # music_key: 曲の同一性キー。CD の TOC(itunes_cddb_1)+トラック番号、
            # 無ければアーティスト/アルバム/トラック/曲名から作る。取り込み時に
            # 「もう入っている曲か」を置き場所に依らず判定するために持つ。
            conn.execute('ALTER TABLE videos ADD COLUMN music_key TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # frame_table: コマ送り用のフレーム表(表示時刻の一覧)。tag.json から取り込む。
            # 可変フレームレートの動画で 1/30 秒の決め打ちが合わないため実フレームを持つ。
            conn.execute('ALTER TABLE videos ADD COLUMN frame_table TEXT')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # drop_count / scramble_count: drop_error から畳んだ件数。
            # 重複索引(list_episode_index)は全video分を作るため、そこで毎回
            # drop_error を JSON 解析していた(実測 12,734本で約2秒)。
            # 導出規則は drop_scramble_counts に集約したままで、結果だけ列に持つ。
            # drop_error を書く場所では必ず一緒に更新すること(_set_drop_counts)。
            conn.execute('ALTER TABLE videos ADD COLUMN drop_count INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            conn.execute('ALTER TABLE videos ADD COLUMN scramble_count INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        # 既存動画の backfill: 未設定(NULL)の行を drop_error から一括で埋める
        try:
            rows = conn.execute(
                "SELECT id, drop_error FROM videos WHERE drop_count IS NULL").fetchall()
            for r in rows:
                drop, scramble = drop_scramble_counts(r['drop_error'])
                conn.execute("UPDATE videos SET drop_count=?, scramble_count=? WHERE id=?",
                             (drop, scramble, r['id']))
            if rows:
                conn.commit()
        except Exception as e:
            _migration_error(e)
        try:
            # has_caption: TS由来の字幕(字幕1/字幕2)の有無(1/0)。
            # 一覧は字幕バッジのために captions_json の中身を見るだけなのに、判定を
            # SQL でやると列の実体を読むことになる(実測: videos 全13,187本で
            # length() だけでも66秒、json_extract まで通すと105秒)。アルバム詳細では
            # 生の captions_json をクライアントへ送ってもいて、ULTRAHERO(31本)は
            # 応答18.8MBのうち16.4MBがこれだった。結果だけ列に持ち、一覧は本体に触らない。
            # captions_json/captions2_json を書く場所では必ず一緒に更新すること
            # (_insert_video / update_video。導出規則は caption_flag に集約)。
            conn.execute('ALTER TABLE videos ADD COLUMN has_caption INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        # 既存動画の backfill: 未設定(NULL)の行を captions_json から埋める。
        # 全行の JSON を読むので初回だけ数十秒かかる。字幕は1本で数百KBあり
        # まとめて取ると数GBになるため、id だけ先に取って本体は1行ずつ読む。
        try:
            ids = [r[0] for r in conn.execute(
                "SELECT id FROM videos WHERE has_caption IS NULL")]
            for vid in ids:
                r = conn.execute(
                    "SELECT captions_json, captions2_json FROM videos WHERE id=?",
                    (vid,)).fetchone()
                conn.execute("UPDATE videos SET has_caption=? WHERE id=?",
                             (caption_flag(r['captions_json'], r['captions2_json']), vid))
            if ids:
                conn.commit()
        except Exception as e:
            _migration_error(e)
        for col in ('added_comment_tracks', 'max_comment_count'):
            try:
                # 実況コメントの追加トラック数と、一番多いトラックの件数。
                # 一覧で毎回 comments_json(合計1.08GB)を読んでいたのを列にする。
                # comments_json を書く場所では必ず一緒に更新すること
                # (_insert_video / update_video。導出規則は comment_track_stats)
                conn.execute(f'ALTER TABLE videos ADD COLUMN {col} INTEGER')
            except Exception as e:
                _migration_error(e)  # 既にカラムが存在する場合は無視
        try:
            # 有料の番組か（1=有料 / 0=無料 / NULL=分からない）。録画の is_paid を tag.json 経由で引き継ぐ。
            # 利用者ごとの権限（有料の番組を見られるか）でライブラリを絞るのに使う
            conn.execute('ALTER TABLE videos ADD COLUMN is_paid INTEGER')
        except Exception as e:
            _migration_error(e)  # 既にカラムが存在する場合は無視
        for col in ('media_kind', 'artist', 'source_path'):
            try:
                # 音楽(logic.music.music_import)。media_kind は未設定(NULL)なら動画なので
                # 既存行の backfill は要らない。artist は表示用、source_path は
                # 変換元の原本(AIFF等)で、再生対象は file_path(再生用MP4)の方。
                conn.execute(f'ALTER TABLE videos ADD COLUMN {col} TEXT')
            except Exception as e:
                _migration_error(e)  # 既にカラムが存在する場合は無視
