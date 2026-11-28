"""テーブルの作成と移行"""

import json


class _SchemaMixin:
    """UsersDB の一部（テーブルの作成と移行）。"""

    def init_db(self):
        with self._conn() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    username      TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    is_admin      INTEGER DEFAULT 0,
                    status        TEXT DEFAULT 'pending',
                    created_at    TEXT DEFAULT (datetime('now'))
                );
                -- ネイティブアプリ用の長期トークン。毎回ログインさせないためのもの。
                -- 端末ごとに1本発行し、失効は行を消さず revoked_at を立てて行う。
                -- 生のトークンは持たず SHA-256 だけ保存する（DBが漏れても使えない）。
                CREATE TABLE IF NOT EXISTS app_tokens (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT UNIQUE NOT NULL,
                    name       TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    revoked_at TEXT DEFAULT NULL
                );
                CREATE TABLE IF NOT EXISTS user_prefs (
                    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    tweaks         TEXT DEFAULT '{}',
                    channel_filter TEXT DEFAULT '[]',
                    time_filter    TEXT DEFAULT '{}',
                    allowed_hours  TEXT DEFAULT NULL,
                    -- 利用者ごとの非公開カテゴリ。ここに入れたカテゴリの video は
                    -- 通常の一覧に出さず、プライベートモードを入れている間だけ見える
                    private_categories TEXT DEFAULT '[]',
                    updated_at     TEXT DEFAULT (datetime('now'))
                );
                -- 管理者が与えるアクセス権。承認しただけでは何も見えず、
                -- ここに許可を入れて初めて見えるようにする（既定は全部不許可）。
                -- screens/nodes/stations は許可リスト（['*'] で全部）、
                -- deny_categories はカテゴリの NG リスト（入っているものだけ隠す）。
                CREATE TABLE IF NOT EXISTS user_perms (
                    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    screens         TEXT DEFAULT '[]',
                    nodes           TEXT DEFAULT '[]',
                    stations        TEXT DEFAULT '[]',
                    deny_categories TEXT DEFAULT '[]',
                    can_write       INTEGER DEFAULT 0,
                    guides          TEXT DEFAULT '[]',
                    paid            INTEGER DEFAULT 0,
                    updated_at      TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS watch_history (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    onid         INTEGER,
                    tsid         INTEGER,
                    sid          INTEGER,
                    eid          INTEGER,
                    eit_start    TEXT,
                    title        TEXT,
                    episode_num  INTEGER,
                    episode_name TEXT,
                    last_type    TEXT,
                    last_id      TEXT,
                    file_key     TEXT NOT NULL,
                    progress     REAL DEFAULT 0,
                    resume_tot   TEXT,
                    pos          REAL,
                    play_count   INTEGER DEFAULT 0,
                    updated_at   TEXT DEFAULT (datetime('now')),
                    UNIQUE(user_id, file_key)
                );
                -- プレイリスト（ミュージック）。kind='folder' なら中に他のプレイリストを
                -- 入れる箱、'playlist' なら曲の集まり。並びは sort_order。
                CREATE TABLE IF NOT EXISTS playlists (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name           TEXT NOT NULL,
                    kind           TEXT NOT NULL DEFAULT 'playlist',
                    parent_id      INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
                    created_at     TEXT DEFAULT (datetime('now')),
                    updated_at     TEXT DEFAULT (datetime('now')),
                    last_played_at TEXT
                );
                CREATE TABLE IF NOT EXISTS playlist_items (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                    video_id    INTEGER NOT NULL,
                    sort_order  INTEGER DEFAULT 0,
                    added_at    TEXT DEFAULT (datetime('now')),
                    UNIQUE(playlist_id, video_id)
                );
                -- 曲のお気に入り（ミュージックの「曲」タブ用。アルバム単位のマイリストとは別）
                CREATE TABLE IF NOT EXISTS music_favorites (
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    video_id   INTEGER NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (user_id, video_id)
                );
                -- マイリスト(お気に入りアルバム)。ユーザーごとに持つ。
                -- video.db 側の album を参照するが DB が別なので外部キーは張らない
                -- (アルバム削除時の掃除は一覧取得時に存在しないIDを除くことで吸収する)。
                -- 入力欄の履歴（欄ごと・新しい順の JSON 配列）。端末を替えても同じ候補を出すため
                CREATE TABLE IF NOT EXISTS input_history (
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    hkey       TEXT NOT NULL,
                    items      TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (user_id, hkey)
                );
                CREATE TABLE IF NOT EXISTS mylist (
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    album_id   INTEGER NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (user_id, album_id)
                );
            ''')
        self._migrate()

    # ── users ──────────────────────────────────────────────────────────

    def _migrate(self):
        """既存DBへの列追加。承認フローを入れる前からいるユーザーは承認済みにする。"""
        with self._conn() as c:
            pcols = [r[1] for r in c.execute('PRAGMA table_info(user_prefs)')]
            if 'private_categories' not in pcols:
                c.execute("ALTER TABLE user_prefs ADD COLUMN private_categories TEXT DEFAULT '[]'")
            wcols = [r[1] for r in c.execute('PRAGMA table_info(watch_history)')]
            if 'play_count' not in wcols:
                # 再生回数。最後まで見た(進捗が閾値を越えた)たびに1つ増える
                c.execute('ALTER TABLE watch_history ADD COLUMN play_count INTEGER DEFAULT 0')
            permcols = [r[1] for r in c.execute('PRAGMA table_info(user_perms)')]
            if 'guides' not in permcols:
                # 番組表のアドオンの許可。入れる前から番組表を見られた人は、アドオンの番組表も全部見られるままにする
                c.execute("ALTER TABLE user_perms ADD COLUMN guides TEXT DEFAULT '[]'")
                c.execute('''UPDATE user_perms SET guides='["*"]' '''
                          '''WHERE screens LIKE '%"epg"%' OR screens LIKE '%"*"%' ''')
            if 'paid' not in permcols:
                # 有料の番組を見られる・予約できるか。入れる前からいる利用者は今までどおり見られるままにする
                c.execute('ALTER TABLE user_perms ADD COLUMN paid INTEGER DEFAULT 0')
                c.execute('UPDATE user_perms SET paid=1')
            cols = [r[1] for r in c.execute('PRAGMA table_info(users)')]
            if 'status' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'pending'")
                c.execute("UPDATE users SET status='approved'")
            # アクセス権を入れる前からいるユーザーは全許可にする（急に何も見えなくしない）
            all_ = json.dumps(['*'])
            for (uid,) in c.execute('SELECT id FROM users WHERE id NOT IN '
                                    '(SELECT user_id FROM user_perms)').fetchall():
                c.execute('INSERT INTO user_perms (user_id, screens, nodes, stations, can_write) '
                          'VALUES (?,?,?,?,1)', (uid, all_, all_, all_))
