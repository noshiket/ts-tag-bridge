"""話数の照合と非公開の判定"""

import json
from typing import List
from .common import (  # noqa: F401
    _has_announce,
    _has_drop_or_scramble,
    _with_issue_fields,
    drop_scramble_counts,
)
from .privacy import _PrivacyMixin


class _EpisodesMixin(_PrivacyMixin):
    """VideoDB の一部（話数の照合と非公開の判定）。"""

    def find_videos_by_program(self, onid: int, tsid: int, sid: int, eid: int) -> List[dict]:
        """同一番組(onid/tsid/sid/eid 一致)の video を created_at 降順で返す。
        視聴履歴(録画)→動画の解決に使う。話数選択用に trim_segments を含める。"""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, eit_start_time, trim_segments, created_at FROM videos "
            "WHERE onid=? AND tsid=? AND sid=? AND eid=? ORDER BY created_at DESC",
            (onid, tsid, sid, eid)).fetchall()
        return [dict(r) for r in rows]

    def has_clean_episode(self, sid, folder, title,
                          episode_number, episode_name, category=None) -> bool:
        """sid/folder(album名)/title(series名)/episode_number/episode_name が一致する
        video のうち、ドロップ/スクランブルも放送異常告知(announce)も無いものが1件でも
        あれば True を返す（= 分割セグメントを SKIP してよい）。一致が無い、または一致が
        全てドロップ/スクランブル有り・告知有りなら False。

        category(録画のカテゴリ名 list/JSON文字列/スカラー)が与えられた場合は、
        候補videoの実効カテゴリ(video/series/albumノードに付与された名前の和集合)と
        交差することも要求する（同名別番組の誤SKIP防止）。

        episode_number/episode_name は videos が TEXT 列のため str 比較に正規化する。
        話数/話数名は NULL と '' を同じ「未設定」として比較する(確定値の登録経路によって
        両方が入るため。find_registered_episodes と同じ規則)。話数も話数名も未設定の場合は
        照合できないので False を返す(話数の無いvideo全部と当たるのを防ぐ)。
        sid は INTEGER 列に合わせて int 化する。"""
        def _s(v):
            return '' if v is None else str(v)

        if _s(episode_number) == '' and _s(episode_name) == '':
            return False
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            pass
        wanted = category
        if isinstance(wanted, str):
            try:
                parsed = json.loads(wanted)
                wanted = parsed if isinstance(parsed, list) else [wanted]
            except (json.JSONDecodeError, ValueError):
                wanted = [wanted]
        wanted = {str(c) for c in (wanted or []) if c}
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT v.drop_error, v.announce, v.id, v.series_id, s.album_id FROM videos v "
            "LEFT JOIN series s ON v.series_id = s.id "
            "LEFT JOIN albums a ON s.album_id = a.id "
            "WHERE v.sid IS ? AND a.name IS ? AND s.name IS ? "
            "AND COALESCE(v.episode_number, '') = ? AND COALESCE(v.episode_name, '') = ?",
            (sid, None if folder is None else str(folder), None if title is None else str(title),
             _s(episode_number), _s(episode_name))
        ).fetchall()
        for r in rows:
            if _has_drop_or_scramble(r['drop_error']):
                continue
            # 放送異常告知(テロップ)がある回は撮り直したいので SKIP しない。
            # 予約の重複スキップ(check_duplicate_skip → allow_duplicate)と条件を揃える。
            if _has_announce(r['announce']):
                continue
            if wanted:
                have = set()
                for node_type, node_id in (('video', r['id']), ('series', r['series_id']),
                                           ('album', r['album_id'])):
                    if node_id is None:
                        continue
                    have.update(name for (name,) in conn.execute(
                        "SELECT c.name FROM category_nodes cn "
                        "JOIN categories c ON cn.category_id = c.id "
                        "WHERE cn.node_type=? AND cn.node_id=?", (node_type, node_id)))
                if not (wanted & have):
                    continue
            return True
        return False

    def list_episode_index(self) -> list:
        """全videoの重複表示用コンパクト索引。録画一覧の構築時に一括プリフェッチして
        (album, series, episode_number, episode_name) で照合する。

        drop_error は読まず drop_count/scramble_count 列を使う(カバリングインデックス
        idx_videos_epindex で行本体を触らずに済ませるため)。そのぶん、列が未設定の行が
        あると黙ってドロップ0として扱われてしまうので、ここで先に埋めておく。
        起動時の backfill 後に旧バージョンが書いた行があっても取りこぼさない。
        """
        conn = self._get_conn()
        pend = conn.execute(
            "SELECT id, drop_error FROM videos WHERE drop_count IS NULL").fetchall()
        if pend:
            for r in pend:
                drop, scramble = drop_scramble_counts(r['drop_error'])
                conn.execute("UPDATE videos SET drop_count=?, scramble_count=? WHERE id=?",
                             (drop, scramble, r['id']))
            conn.commit()
        rows = conn.execute(
            "SELECT v.id, v.eit_station_name, v.comment_count, v.duration_sec, "
            "v.episode_number, v.episode_name, v.drop_count, v.scramble_count, v.announce, v.sid, v.series_id, "
            "s.name AS series, a.name AS album "
            "FROM videos v "
            "LEFT JOIN series s ON v.series_id = s.id "
            "LEFT JOIN albums a ON s.album_id = a.id").fetchall()
        return [_with_issue_fields(dict(r)) for r in rows]

    def episode_index_token(self):
        """list_episode_index の材料が変わったかを判定するための軽い指紋。

        索引は videos と、JOIN する series.name / albums.name から作られるので、
        3テーブルの件数と最終更新をまとめて見る。全件走査(約2.9秒)に対して
        こちらは 4ms 程度なので、変化がなければ再構築を丸ごと省ける。
        """
        conn = self._get_conn()
        return conn.execute(
            "SELECT (SELECT COUNT(*) FROM videos), (SELECT MAX(updated_at) FROM videos),"
            " (SELECT COUNT(*) FROM series), (SELECT MAX(updated_at) FROM series),"
            " (SELECT COUNT(*) FROM albums), (SELECT MAX(updated_at) FROM albums)").fetchone()

    def find_registered_episodes(self, folder, title, episode_number, episode_name) -> list:
        """folder(album名)/title(series名)/episode_number/episode_name が一致するvideoを
        録画の重複表示用に返す(sidは比較しない)。各行: id/eit_station_name/comment_count/
        duration_sec/episode_number/episode_name/series/album/has_issue。

        話数/話数名は NULL と '' を同じものとして比較する。確定値の登録経路によって
        未設定が NULL になったり '' になったりするため（実データで両方存在する）、
        厳密比較にすると同じ話が別物になり重複を取りこぼす。"""
        def _s(v):
            return '' if v is None else str(v)
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT v.id, v.eit_station_name, v.comment_count, v.duration_sec, "
            "v.episode_number, v.episode_name, v.drop_error, v.sid, v.allow_duplicate, v.has_secondary_audio, "
            "v.announce, v.series_id, s.album_id, s.name AS series, a.name AS album "
            "FROM videos v "
            "LEFT JOIN series s ON v.series_id = s.id "
            "LEFT JOIN albums a ON s.album_id = a.id "
            "WHERE a.name IS ? AND s.name IS ? "
            "AND COALESCE(v.episode_number, '') = ? AND COALESCE(v.episode_name, '') = ?",
            (None if folder is None else str(folder), None if title is None else str(title),
             _s(episode_number), _s(episode_name))
        ).fetchall()
        return [_with_issue_fields(dict(r)) for r in rows]


    def data_version(self) -> int:
        """他の接続がDBを変えると進む番号（PRAGMA data_version）。

        アルバム一覧のキャッシュは重いので長めに持ちたいが、ワーカー(エンコード完了時の
        登録など)は HTTP を通らないため after_request の無効化に載らない。この番号を
        キャッシュキーに混ぜると、外から変わった時だけ作り直せる。
        """
        try:
            return int(self._get_conn().execute('PRAGMA data_version').fetchone()[0])
        except Exception:
            return 0
