"""recordings・programs の列の移行と古い列の片付け（init_db の一部）"""

from ..migrations import migration_error
from .common import logger


def _migration_error(e):
    migration_error(e, logger)


class _ColumnMigrationsMixin:
    """recordings・programs の列の移行と古い列の片付け（init_db の一部）"""

    def _migrate_recordings_columns(self, conn):
        """recordings に後から足した列。"""
        # 既存テーブルへのカラム追加マイグレーション
        for col_def in (
            "onid INTEGER",
            "tsid INTEGER",
            "sid INTEGER",
            "eid INTEGER",
            "state TEXT NOT NULL DEFAULT 'pending'",
            "shimakaze_job_id INTEGER",
            "output_path TEXT",
            "error_message TEXT",
            "parser_error TEXT",
            "updated_at TEXT NOT NULL DEFAULT ''",
            "title TEXT",
            "folder TEXT",
            "episode_number TEXT",
            "episode_name TEXT",
            "category TEXT",
            "eit_title TEXT",
            "eit_description TEXT",
            "eit_extended_info TEXT",
            "eit_start_time TEXT",
            "eit_end_time TEXT",
            "eit_station_name TEXT",
            "edcb_ts_path TEXT",
            "host_ts_path TEXT",
            "app_ts_path TEXT",
            "amatsukaze_ts_path TEXT",
            "konomitv_ts_path TEXT",
            "drop_error TEXT",
            "file_exist INTEGER",
            "recording_start_time TEXT",
            "recording_end_time TEXT",
            "rec_status INTEGER",
            "rec_comment TEXT",
            "furigana TEXT",
            "auto_send TEXT",
            "else_info TEXT",
            "is_text_parser INTEGER",
            "app_output_path TEXT",
            "app_output_path_format TEXT",
            "encode_dir TEXT",
            "setting TEXT",
            "eit_genre TEXT",
            "eit_video_info TEXT",
            "eit_audio_info TEXT",
            "file_size INTEGER",
            "duration_sec REAL",
            "text_parser_result TEXT",
            "segments TEXT",
            "edcb_tag TEXT",
            "server_url TEXT",
            "probe_result TEXT",
            "eit_overlap REAL",
            "comments_json TEXT",
            "comment_count INTEGER",
            "captions_json TEXT",
            "captions2_json TEXT",
            "key_frames TEXT",
            # コマ送り用のフレーム表(表示時刻の一覧)。H.264/H.265 は自前パーサが
            # 使えないため ffprobe で作る。キーフレームだけの key_frames とは別物。
            "frame_table TEXT",
            # CMカット解析の結果(logic/cmcut.analyze の戻り値 JSON)。
            # trim/ロゴ区間/無音区間/シーンチェンジ位置。数KBなので通常列でよい
            "cm_analysis TEXT",
            "tmp_dirs TEXT",
            "to_encode_info TEXT",
            "rec_drops INTEGER DEFAULT 0",
            "rec_scrambles INTEGER DEFAULT 0",
            "auto_add_id INTEGER",
            "thumbnail_path TEXT",
            "thumbnail_tile_path TEXT",
            "thumbnail_info TEXT",
            "duplicate_info TEXT",
            # scan_cancelled: 解析(add_recording)を手動で中止した印。state は pending に戻すが、
            # この印がある間録画の走査は拾わない（戻した直後に自動再開しないため）。
            # 手動の再スキャン要求でクリアする。
            "scan_cancelled INTEGER DEFAULT 0",
            # transfer_state: 別ノードへエンコードを委譲した時の転送の進み具合。
            # {'node','phase','sent','total','started_at','updated_at','error'} の JSON。
            # 転送中はマスター側の state を変えない設計なので、これが無いと
            # 数GB送っている間「何も起きていない」ようにしか見えなかった
            "transfer_state TEXT",
            # addon: この録画を作ったアドオンの名前。コア/EDCB 由来は NULL。
            # 放送用の EIT が無い等、通常と違う扱いが要るときに「誰に聞けばいいか」
            # を決めるために持つ。中身の解釈はそのアドオンに任せる（コアは名前しか見ない）
            "addon TEXT",
            # cm_error: CM解析が失敗した理由。error_message は使えない
            # （あれを立てると一覧で録画自体がエラー表示になる。録画は成功している）。
            # 従来は INFO ログへ落とすだけで、再起動で消えると理由が辿れなかった。
            "cm_error TEXT",
            # edcb_title: 予約(EDCB の EPG)から写した番組名。eit_title は録画の TS から読んだ
            # 番組名で上書きされるので、EDCB 由来との差を後から見比べられるよう残す
            "edcb_title TEXT",
            # 有料の番組か（1=有料 / 0=無料 / NULL=分からない）。TS の番組情報（EIT の free_CA_mode）から。
            # 利用者ごとの権限（有料の番組を見られるか）で絞るのに使う
            "is_paid INTEGER",
            # shoboi_info: しょぼいカレンダーの番組表・作品情報から引いたこの放送の情報（JSON。
            # shoboi_store.info_for）。番組表に無ければ {}、まだ引いていなければ NULL
            "shoboi_info TEXT",
        ):
            try:
                conn.execute(f'ALTER TABLE recordings ADD COLUMN {col_def}')
            except Exception as e:
                _migration_error(e)  # 既にカラムが存在する場合は無視

    def _migrate_programs_columns(self, conn):
        """programs に後から足した列。"""
        # programs テーブルへのカラム追加マイグレーション
        for col_def in (
            "parser_error TEXT",
            "start_margin INTEGER",
            "end_margin INTEGER",
            "title TEXT",
            "folder TEXT",
            "episode_name TEXT",
            "episode_number TEXT",
            "category TEXT",
            "furigana TEXT",
            "else_info TEXT",
            "auto_send INTEGER",
            "is_text_parser INTEGER",
            "app_output_path TEXT",
            "app_output_path_format TEXT",
            "setting TEXT",
            "genre TEXT",
            "video_info TEXT",
            "audio_info TEXT",
            "edcb_tag TEXT",
            "server_url TEXT",
            # このアプリが自動で録画無効にした理由('duplicate')。EDCB側のスキップと
            # 区別して一覧で絞り込めるようにする。手動/EDCB由来の無効は NULL のまま
            "auto_skip_reason TEXT",
            # 配信の予約のサービスID。EDCB の予約は EDCB 側が持っているので
            # ここは NULL のまま。アドオンが入れた予約だけが値を持ち、
            # text_parser のパターン(SID{n}-tp.json)の引き当てに使う
            "sid INTEGER",
            # 配信のチャンネルID(アドオンが決める文字列。'anime-ch' 等)。
            # 局名は配信側の都合で変わるが、これは変わらないので番組表の
            # 予約済み表示の引き当てに使う。EDCB の予約は NULL
            # （ARIB の onid/nid は整数の別物なので流用しない）
            "ch TEXT",
            # shoboi_info: しょぼいカレンダーの番組表・作品情報から引いたこの放送の情報（JSON。
            # shoboi_store.info_for）。番組表に無ければ {}、まだ引いていなければ NULL
            "shoboi_info TEXT",
        ):
            try:
                conn.execute(f'ALTER TABLE programs ADD COLUMN {col_def}')
            except Exception as e:
                _migration_error(e)

    def _drop_old_columns(self, conn):
        """使わなくなった列の削除と、列の名前の変更。"""
        # 旧カラム削除マイグレーション（SQLite 3.35+ 対応）
        for col in ('shimakaze_job_id', 'ts_path', 'output_path'):
            try:
                conn.execute(f'ALTER TABLE programs DROP COLUMN {col}')
            except Exception as e:
                _migration_error(e)
        # recordings.ts_path 削除マイグレーション
        try:
            conn.execute('ALTER TABLE recordings DROP COLUMN ts_path')
        except Exception as e:
            _migration_error(e)
        # recordings.state 'scanning' → 'found' マイグレーション
        conn.execute("UPDATE recordings SET state='found' WHERE state='scanning'")
        conn.commit()
        # recordings.station_name → eit_station_name リネームマイグレーション（SQLite 3.25+）
        try:
            conn.execute('ALTER TABLE recordings RENAME COLUMN station_name TO eit_station_name')
        except Exception as e:
            _migration_error(e)
