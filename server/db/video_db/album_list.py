"""アルバムの一覧（フォルダ・置き場所・音楽か動画か・絞り込みと集計）"""

from typing import Optional, List
from .common import UNCATEGORIZED_ALBUM_ID, UNCATEGORIZED_ALBUM_NAME
from .music_albums import _fs_fold


class _AlbumListMixin:
    """アルバムの一覧（フォルダ・置き場所・音楽か動画か・絞り込みと集計）"""

    # ------------------------------------------------------------------
    # ライブラリ参照
    # ------------------------------------------------------------------
    def _album_folder_map(self, conn) -> dict:
        """album_id -> その album の動画が実際に置かれているフォルダ名の集合。

        出力先は {$encode_dir}/{$folder}/… なので、file_path の親ディレクトリ名が
        その動画の folder になる。アルバム名と食い違っていたら分類がおかしい
        （{$folder} が展開されないまま作られた、別名のフォルダに入った 等）。

        音楽(media_kind='audio')は対象外。album がアーティスト名で、ファイルは
        アーティスト配下のアルバムフォルダに置かれるため、必ず食い違う。
        """
        rows = conn.execute("""
            SELECT COALESCE(s.album_id, ?) AS album_id, v.file_path AS fp
            FROM videos v JOIN series s ON v.series_id = s.id
            WHERE v.file_path IS NOT NULL AND v.file_path != ''
              AND (v.media_kind IS NULL OR v.media_kind != 'audio')
        """, (UNCATEGORIZED_ALBUM_ID,)).fetchall()
        # 13,000本ぶん回るので、os.path ではなく rsplit で切る（実測 93ms → 62ms）。
        # SQL 側で rtrim/replace を使って畳む案は逆に遅かった（420ms）
        out: dict = {}
        for album_id, fp in rows:
            parts = fp.rsplit('/', 2)
            if len(parts) >= 2 and parts[-2]:
                # フォルダ名 -> 本数。何本が食い違っているかも画面に出す
                d = out.setdefault(album_id, {})
                d[parts[-2]] = d.get(parts[-2], 0) + 1
        return out

    def _album_dirs_map(self, conn, dir_roots: Optional[List[str]]) -> dict:
        """album_id -> その album 内の動画が置かれている保存先ディレクトリ(dir_roots のうち
        file_path の前方一致で該当したもの)のリスト。ライブラリのディレクトリ絞り込み用。
        album_id が NULL(未分類)の分は UNCATEGORIZED_ALBUM_ID に集約する。"""
        roots = [d.rstrip('/') for d in (dir_roots or []) if d]
        if not roots:
            return {}
        # 保存先の判定を SQL 側(CASE + 前方一致)でやり、album ごとに1行へ畳んでから取り出す
        cases = ' '.join(f"WHEN v.file_path LIKE ? THEN ?" for _ in roots)
        params = []
        for d in roots:
            params += [d + '/%', d]
        rows = conn.execute(f"""
            SELECT COALESCE(s.album_id, ?) AS album_id,
                   CASE {cases} ELSE NULL END AS root
            FROM videos v JOIN series s ON v.series_id = s.id
            GROUP BY album_id, root
        """, [UNCATEGORIZED_ALBUM_ID] + params).fetchall()
        out: dict = {}
        for r in rows:
            if r['root']:
                out.setdefault(r['album_id'], []).append(r['root'])
        for k in out:
            out[k] = sorted(set(out[k]))
        return out

    def media_kind_sql(self, alias: str, kind: Optional[str]) -> str:
        """一覧クエリの WHERE へ足す「動画だけ / 音楽だけ」の条件。

        media_kind は未設定(NULL)なら動画。kind=None は絞らない（従来どおり全部）。
        """
        if kind == 'audio':
            return f" AND {alias}.media_kind = 'audio'"
        if kind == 'video':
            return f" AND ({alias}.media_kind IS NULL OR {alias}.media_kind != 'audio')"
        return ''

    def get_albums(self, dir_roots: Optional[List[str]] = None, perm_conds=None,
                   private_categories=None, media_kind=None) -> list:
        """album 一覧を各 album 内の最新 video.created_at 降順で返す。
        genre はジャンル絞り込み用に album 内の最新動画の eit_genre を代表値として付与し、
        latest_broadcast_at は放送日順ソート用に album 内動画の最新 eit_start_time を付与する。
        dir_roots(config の encode_dir_list)を渡すと、各 album に dirs（その album の動画が
        置かれている保存先ディレクトリ一覧）を付与する。

        perm_conds=(条件リスト, 引数) を渡すと、その条件に合う video だけを数えて集計し、
        1本も残らない album は返さない（閲覧権限で絞る用。件数も見える本数に揃う）。"""
        conn = self._get_conn()
        pc = (' AND ' + ' AND '.join(perm_conds[0])) if perm_conds and perm_conds[0] else ''
        pp = list(perm_conds[1]) if perm_conds and perm_conds[0] else []
        # 非公開は本数にも数えない（0本になったアルバムは返らない＝一覧から消える）
        pc += self.private_filter_sql('v', private_categories)
        # 音楽と動画は別タブに分ける。片方だけ数え、0本になったアルバムは返さない
        pc += self.media_kind_sql('v', media_kind)
        # genre はアルバム毎の相関サブクエリだと videos 全走査×アルバム数になり極端に
        # 遅い(実測14秒)ため、window関数の一括クエリで別取りして合成する
        rows = conn.execute("""
            SELECT
                a.id,
                a.name,
                a.description,
                COUNT(v.id)          AS video_count,
                MAX(v.created_at)    AS latest_video_at,
                MAX(v.updated_at)    AS latest_video_updated_at,
                MAX(v.eit_start_time) AS latest_broadcast_at,
                MIN(v.eit_start_time) AS earliest_broadcast_at
            FROM albums a
            LEFT JOIN series s ON s.album_id = a.id
            LEFT JOIN videos v ON v.series_id = s.id""" + pc + """
            GROUP BY a.id
            ORDER BY MAX(v.created_at) DESC, a.created_at DESC
        """, pp).fetchall()
        genre_rows = conn.execute("""
            SELECT album_id, eit_genre FROM (
              SELECT s.album_id AS album_id, v.eit_genre,
                     ROW_NUMBER() OVER (PARTITION BY s.album_id ORDER BY v.created_at DESC) rn
              FROM videos v JOIN series s ON v.series_id = s.id
              WHERE v.eit_genre IS NOT NULL AND v.eit_genre != '' AND s.album_id IS NOT NULL
            ) WHERE rn = 1
        """).fetchall()
        genres = {r['album_id']: r['eit_genre'] for r in genre_rows}
        dirs_map = self._album_dirs_map(conn, dir_roots)
        folder_map = self._album_folder_map(conn)
        # シリーズ名（一覧の絞り込みで、言葉をシリーズ名にも当てるため）。見える動画があるシリーズだけ
        # （非公開・権限外の動画しか無いシリーズの名前は出さない）
        series_map: dict = {}
        for r in conn.execute(
                "SELECT DISTINCT s.album_id, s.name FROM series s JOIN videos v ON v.series_id = s.id WHERE 1=1" + pc, pp):
            series_map.setdefault(r['album_id'] if r['album_id'] is not None else UNCATEGORIZED_ALBUM_ID, []).append(r['name'])
        # 実効カテゴリ: attach_categories と同じ解決順(video→series→album)で動画毎に出た
        # カテゴリを album 単位に集約する。動画一覧は1クエリ、カテゴリは attach_categories の
        # 一括バッチのみ（album 数だけの個別クエリは投げない）。
        vrows = [dict(r) for r in conn.execute(
            "SELECT v.id, v.series_id, s.album_id FROM videos v "
            "JOIN series s ON v.series_id = s.id")]
        cats_map = {}
        for r in self.attach_categories(vrows):
            aid = r['album_id'] if r['album_id'] is not None else UNCATEGORIZED_ALBUM_ID
            names = cats_map.setdefault(aid, set())
            for cat in r['categories']:
                names.add(cat['name'])

        def _mismatch(album_id, album_name):
            """アルバム名と食い違うフォルダ名と、その本数を返す。"""
            folders = folder_map.get(album_id) or {}
            want = _fs_fold(album_name)
            ng = sorted(f for f in folders if _fs_fold(f) != want)
            return ng, sum(folders[f] for f in ng)

        result = []
        for r in rows:
            if pc and not r['video_count']:
                continue
            a = {**dict(r), 'genre': genres.get(r['id']), 'dirs': dirs_map.get(r['id'], []),
                 'categories': sorted(cats_map.get(r['id'], ())),
                 'series_names': sorted(series_map.get(r['id'], ()))}
            # 分類エラー: フォルダ名がアルバム名と合っていない（画面で先頭に出す）
            a['folder_mismatch'], a['folder_mismatch_count'] = _mismatch(r['id'], r['name'])
            result.append(a)

        # フォルダ未設定(album_id IS NULL)の動画を仮想アルバム「未分類」として合成して追加。
        # 動画が1本も無ければ表示しない。
        uc = conn.execute("""
            SELECT
                COUNT(v.id)           AS video_count,
                MAX(v.created_at)     AS latest_video_at,
                MAX(v.updated_at)     AS latest_video_updated_at,
                MAX(v.eit_start_time) AS latest_broadcast_at,
                MIN(v.eit_start_time) AS earliest_broadcast_at
            FROM series s JOIN videos v ON v.series_id = s.id
            WHERE s.album_id IS NULL""" + pc + """
        """, pp).fetchone()
        if uc and uc['video_count']:
            uc_genre = conn.execute("""
                SELECT v.eit_genre FROM videos v JOIN series s ON v.series_id = s.id
                WHERE s.album_id IS NULL AND v.eit_genre IS NOT NULL AND v.eit_genre != ''
                ORDER BY v.created_at DESC LIMIT 1
            """).fetchone()
            uc_album = {
                'id': UNCATEGORIZED_ALBUM_ID, 'name': UNCATEGORIZED_ALBUM_NAME,
                'description': None, 'genre': uc_genre['eit_genre'] if uc_genre else None,
                'dirs': dirs_map.get(UNCATEGORIZED_ALBUM_ID, []),
                'categories': sorted(cats_map.get(UNCATEGORIZED_ALBUM_ID, ())),
                'series_names': sorted(series_map.get(UNCATEGORIZED_ALBUM_ID, ())),
                **dict(uc),
            }
            # 実アルバムと同じく最新登録日時の降順で並ぶ位置に挿入する。
            pos = len(result)
            for i, a in enumerate(result):
                if (uc_album['latest_video_at'] or '') > (a['latest_video_at'] or ''):
                    pos = i
                    break
            result.insert(pos, uc_album)
        return result
