"""非公開カテゴリ（隠す動画の番号・絞り込みの SQL・動画に効くカテゴリ）"""

from typing import Set


class _PrivacyMixin:
    """非公開カテゴリ（隠す動画の番号・絞り込みの SQL・動画に効くカテゴリ）"""

    def private_video_ids(self, category_names) -> Set[int]:
        """指定カテゴリが効いている video の id。

        どのカテゴリを非公開にするかは利用者ごとに決める(user_prefs.private_categories)。
        カテゴリは album / series / video のどこにでも付き、上位に付けば配下すべてに
        効く(effective_category_names と同じ考え方)。category_nodes を起点に引くので
        videos の全走査にはならない(実測 0〜2ms、43本該当時も 0ms)。

        列に持たせない理由: 上位ノードの付け替えで配下の実効値が一斉に変わるうえ、
        利用者ごとに対象が違うため。この速さなら列を持つ利点が無い。
        """
        names = [n for n in (category_names or []) if n]
        if not names:
            return set()
        conn = self._get_conn()
        ph = ','.join('?' * len(names))
        rows = conn.execute(f"""
            SELECT cn.node_id FROM category_nodes cn
              JOIN categories cc ON cn.category_id = cc.id
             WHERE cc.name IN ({ph}) AND cn.node_type = 'video'
            UNION
            SELECT v.id FROM videos v WHERE v.series_id IN (
                SELECT cn.node_id FROM category_nodes cn
                  JOIN categories cc ON cn.category_id = cc.id
                 WHERE cc.name IN ({ph}) AND cn.node_type = 'series')
            UNION
            SELECT v.id FROM videos v JOIN series s ON v.series_id = s.id
             WHERE s.album_id IN (
                SELECT cn.node_id FROM category_nodes cn
                  JOIN categories cc ON cn.category_id = cc.id
                 WHERE cc.name IN ({ph}) AND cn.node_type = 'album')
        """, names * 3).fetchall()
        return {r[0] for r in rows}

    def private_filter_sql(self, alias: str, private_categories) -> str:
        """一覧クエリの WHERE へ足す「非公開を除く」条件。

        private_categories が空（＝非公開指定なし、またはプライベートモード中に
        呼び出し側が空を渡す）なら何も足さない。
        """
        ids = self.private_video_ids(private_categories)
        if not ids:
            return ''
        return f" AND {alias}.id NOT IN ({','.join(str(int(i)) for i in ids)})"

    def effective_category_names(self, video_id, series_id, album_id) -> Set[str]:
        """videoに実効的に適用されるカテゴリ名の集合を返す。フロンティア方式に依らず
        video/series/album ノードに付与された名前の和集合(重複スキップ判定用の交差比較に使う)。"""
        conn = self._get_conn()
        have = set()
        for node_type, node_id in (('video', video_id), ('series', series_id), ('album', album_id)):
            if node_id is None:
                continue
            have.update(name for (name,) in conn.execute(
                "SELECT c.name FROM category_nodes cn "
                "JOIN categories c ON cn.category_id = c.id "
                "WHERE cn.node_type=? AND cn.node_id=?", (node_type, node_id)))
        return have
