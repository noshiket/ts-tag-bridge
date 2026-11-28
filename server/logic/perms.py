"""perms — 管理者が利用者に与えるアクセス権の判定。

承認されただけでは何も見えない。管理者が与えた許可の範囲だけが見える/触れる。

  screens         … 開ける画面（'epg' 'reservations' 'recresult' 'library' 'encode' 'live'）
  nodes           … 閲覧できるサーバー（federation のピア名。'' はこのサーバー自身）
  stations        … 見られる放送局（'ONID-TSID-SID'）。'net:GR' 'net:BS' 'net:CS' 'net:OTHER' で波の単位
                    （OTHER は局の分からない物: 配信の取り込みなど。局が毎回変わるので局では選べない）
  deny_categories … ライブラリで隠すカテゴリ（NGリスト。ここだけ拒否指定）
  can_write       … 予約追加やエンコード実行などの変更操作ができるか
  guides          … 見られる番組表のアドオン（target='guide' の名前）。番組表の画面の許可も要る
  paid            … 有料の番組（スクランブル）を見られる・予約できるか。分からない物は局の大半で決める（paid_services）

screens/nodes/stations は許可リストで、['*'] なら全部。管理者は常に全許可。

「一覧から消す」だけだと URL 直打ちで中身が取れてしまうので、一覧の絞り込みと
個別取得の拒否（403）を必ず対にすること。
"""

from .perms_sql import ALL, _VideoSqlMixin


def network_of(onid) -> str:
    """局の波（地デジ・BS・CS・その他）。ONID の範囲で決まる"""
    if onid is None:
        return 'OTHER'
    onid = int(onid)
    if 0x7880 <= onid <= 0x7FEF:
        return 'GR'
    if onid == 4:
        return 'BS'
    if onid in (6, 7, 10):
        return 'CS'
    return 'OTHER'

# 画面ID（クライアントのタブIDと合わせる）。設定は誰でも開ける（アカウントだけ見える）
SCREENS = ['epg', 'reservations', 'recresult', 'library', 'encode', 'live']
SCREEN_LABELS = {'epg': '番組表', 'reservations': '予約', 'recresult': '録画結果',
                 'library': 'ライブラリ', 'encode': 'エンコード', 'live': 'ライブ視聴'}


class Perm(_VideoSqlMixin):
    """1リクエストぶんの権限。DBは1回だけ引く。"""

    def __init__(self, user, raw=None):
        self.user = user or None
        self.is_admin = bool(user and user.get('is_admin'))
        raw = raw or {}
        self.screens = set(raw.get('screens') or [])
        self.nodes = set(raw.get('nodes') or [])
        self.stations = set(raw.get('stations') or [])
        self.deny_categories = set(int(c) for c in (raw.get('deny_categories') or [])
                                   if str(c).lstrip('-').isdigit())
        self.can_write = bool(raw.get('can_write')) or self.is_admin
        self.guides = set(raw.get('guides') or [])
        self.paid = bool(raw.get('paid')) or self.is_admin

    # ── 判定 ────────────────────────────────────────────────────────────

    def _ok(self, allowed: set, value) -> bool:
        return self.is_admin or ALL in allowed or value in allowed

    def screen(self, name) -> bool:
        return self._ok(self.screens, name)

    def node(self, name) -> bool:
        """name は空文字/None でこのサーバー自身。自ノードは常に見られる。"""
        return True if not name else self._ok(self.nodes, name)

    def guide(self, name) -> bool:
        """番組表のアドオンを見られるか（番組表の画面の許可と、そのアドオンの許可の両方が要る）"""
        return self.screen('epg') and self._ok(self.guides, name)

    def station(self, onid, tsid, sid) -> bool:
        if self.is_admin or ALL in self.stations:
            return True
        if f'net:{network_of(onid)}' in self.stations:
            return True
        if onid is None or sid is None:
            return False        # 局が分からないものは許可の範囲外として隠す
        return f'{int(onid)}-{int(tsid or 0)}-{int(sid)}' in self.stations

    def station_key(self, key) -> bool:
        """'ONID-TSID-SID' 形式の文字列で判定する。"""
        if self.is_admin or ALL in self.stations:
            return True
        head = str(key).split('-')[0]
        if head.isdigit() and f'net:{network_of(int(head))}' in self.stations:
            return True
        return str(key) in self.stations

    def category(self, category_id) -> bool:
        """NGカテゴリでなければ True。"""
        if self.is_admin or category_id is None:
            return True
        return int(category_id) not in self.deny_categories

    def program(self, is_paid, onid, tsid, sid) -> bool:
        """番組を見られるか（局と、有料の番組の許可）。is_paid が None なら局の大半で決める"""
        if not self.station(onid, tsid, sid):
            return False
        if self.paid:
            return True
        if is_paid is None:
            from .paid_services import paid_services
            is_paid = f'{onid}-{tsid}-{sid}' in paid_services()
        return not is_paid

    @property
    def all_stations(self) -> bool:
        return self.is_admin or ALL in self.stations

    @property
    def nothing(self) -> bool:
        """何ひとつ許可されていない（＝アカウント設定しか触れない）。"""
        return not self.is_admin and not self.screens and not self.stations

    # ── 一覧の絞り込み ──────────────────────────────────────────────────

    def filter_items(self, items, get_service=None):
        """dict のリストを局で絞る。get_service 省略時は onid/tsid/sid キーを見る。"""
        if self.all_stations and self.paid:
            return list(items)
        out = []
        for it in items:
            if get_service:
                onid, tsid, sid = get_service(it)
            else:
                onid, tsid, sid = it.get('onid'), it.get('tsid'), it.get('sid')
            if self.program(_item_paid(it), onid, tsid, sid):
                out.append(it)
        return out

    def to_json(self) -> dict:
        return {
            'is_admin': self.is_admin,
            'screens': sorted(self.screens),
            'nodes': sorted(self.nodes),
            'stations': sorted(self.stations),
            'deny_categories': sorted(self.deny_categories),
            'can_write': self.can_write,
            'guides': sorted(self.guides),
            'paid': self.paid,
        }


def _item_paid(it):
    """一覧の1件が有料か（is_paid か、番組情報の free_ca。分からなければ None）"""
    if it.get('is_paid') is not None:
        return bool(it['is_paid'])
    if it.get('free_ca') is not None:
        return not it['free_ca']
    return None


def of(user, db) -> Perm:
    """ユーザー(dict)とUsersDBから Perm を作る。未ログインは全部不許可。"""
    if not user:
        return Perm(None)
    if user.get('is_admin'):
        return Perm(user)
    return Perm(user, db.get_perms(user['id']))
