"""perms の一部: ライブラリの絞り込みの SQL（ライブラリはページングするので、絞り込みは SQL 側でやる）"""

ALL = '*'
NETS = ('GR', 'BS', 'CS', 'OTHER')


class _VideoSqlMixin:
    """Perm の一部（videos を絞る SQL）。"""


    def video_conds(self, alias='v'):
        """videos に足す WHERE 条件のリストと引数を返す。制限なしなら ([], [])。

        局は許可リスト、カテゴリはNGリスト。カテゴリは動画/シリーズ/アルバムの
        どのレベルに付いていても効かせる（category_nodes.node_type の3種）。
        局と有料の番組は放送の物だけに効かせる。曲（media_kind='audio'）は局を持たず、
        局が分からない物として隠され、ミュージックのアーティストが1件も出なかった。
        """
        if self.is_admin:
            return [], []
        conds, params = [], []
        if ALL not in self.stations:
            if not self.stations:
                return ['0'], []             # 1局も許可されていない＝何も見えない
            ors, keys = [], sorted(s for s in self.stations if not s.startswith('net:'))
            if keys:
                ors.append(f"({alias}.onid || '-' || {alias}.tsid || '-' || {alias}.sid) IN ({','.join('?' * len(keys))})")
                params += keys
            ors += [_net_sql(alias, s[4:]) for s in sorted(self.stations) if s.startswith('net:') and s[4:] in NETS]
            conds.append(_not_music(alias, '(' + ' OR '.join(ors) + ')' if ors else '0'))
        if not self.paid:
            # 有料の番組。分からない物（is_paid が空）は局の大半で決める
            from .paid_services import paid_services
            svc = sorted(paid_services())
            key = f"({alias}.onid || '-' || {alias}.tsid || '-' || {alias}.sid)"
            unknown_ok = f'NOT {key} IN ({",".join("?" * len(svc))})' if svc else '1'
            conds.append(_not_music(alias, f'({alias}.is_paid = 0 OR ({alias}.is_paid IS NULL AND {unknown_ok}))'))
            params += svc
        if self.deny_categories:
            ph = ','.join('?' * len(self.deny_categories))
            conds.append(
                f"NOT EXISTS (SELECT 1 FROM category_nodes cn WHERE cn.category_id IN ({ph}) AND ("
                f"(cn.node_type='video'  AND cn.node_id = {alias}.id) OR "
                f"(cn.node_type='series' AND cn.node_id = {alias}.series_id) OR "
                f"(cn.node_type='album'  AND cn.node_id = "
                f"(SELECT album_id FROM series WHERE id = {alias}.series_id))))")
            params += sorted(self.deny_categories)
        return conds, params

    def video_ids_sql(self):
        """「見てよい video.id」の副問い合わせ。制限なしなら None。

        アルバム一覧のように videos を直接 WHERE できない場所で使う。
        """
        conds, params = self.video_conds('v')
        if not conds:
            return None, []
        return ('SELECT v.id FROM videos v WHERE ' + ' AND '.join(conds)), params

    @property
    def limits_videos(self) -> bool:
        return not self.is_admin and (ALL not in self.stations or bool(self.deny_categories) or not self.paid)


def _not_music(alias: str, cond: str) -> str:
    """放送の物にだけ効かせる条件（曲は通す）"""
    return f"({alias}.media_kind = 'audio' OR {cond})"


def _net_sql(alias: str, net: str) -> str:
    """波の単位の SQL の条件（network_of と同じ決め方）"""
    gr = f'({alias}.onid BETWEEN {0x7880} AND {0x7FEF})'
    bs = f'({alias}.onid = 4)'
    cs = f'({alias}.onid IN (6, 7, 10))'
    if net == 'GR':
        return gr
    if net == 'BS':
        return bs
    if net == 'CS':
        return cs
    return f'({alias}.onid IS NULL OR NOT ({gr} OR {bs} OR {cs}))'
