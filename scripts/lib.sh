# scripts/*.sh が共通で使う部品（直接は実行しない。source して使う）
#
# - REPO / SERVER_DIR / PY / CONFIG: リポジトリ・サーバー・Python・設定ファイルの場所
# - LOG: サーバーのログ（TSTAG_LOG で変えられる）
# - SERVICE: systemd の利用者のサービス名（install-service.sh で入れた物）

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SERVER_DIR="$REPO/server"
PY="$SERVER_DIR/.venv/bin/python"
CONFIG="${TSTAG_CONFIG:-config.yml}"
LOG="${TSTAG_LOG:-/tmp/ts-tag-bridge.log}"
SERVICE="ts-tag-bridge.service"
LOCK=/tmp/ts-tag-bridge-restart.lock

say()  { echo "[ts-tag-bridge] $*"; }
fail() { echo "[ts-tag-bridge] $*" >&2; exit 1; }

need_setup() {
  [ -x "$PY" ] || fail "server/.venv がありません。先に scripts/setup.sh を流してください"
  [ -f "$SERVER_DIR/$CONFIG" ] || fail "server/$CONFIG がありません。scripts/setup.sh が config.yml.example から作ります"
}

# このリポジトリの server で動いている main.py だけ（同じ機械の別のチェックアウトは巻き込まない）
pids_here() {
  local p
  for p in $(pgrep -f "python main.py" 2>/dev/null); do
    [ "$(readlink -f "/proc/$p/cwd" 2>/dev/null)" = "$SERVER_DIR" ] && echo "$p"
  done
}

# 外のポート（HTTPS なら Akebi が待つ）と本体のポート（読み方と既定値は server/boot/ports.py）
ports() { (cd "$SERVER_DIR" && "$PY" boot/ports.py "$CONFIG"); }

# systemd のサービスとして入っているか
service_installed() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user cat "$SERVICE" >/dev/null 2>&1
}

# 本体が起動した Akebi（HTTPS の前段）の残りを片付ける。SIGTERM では本体の後始末が走らず、
# Akebi が外のポートを掴んだまま残る。このアプリのポートの物だけ（ほかのアプリの Akebi は触らない）
kill_orphan_akebi() {
  local port akebi
  read -r port _ <<< "$(ports)"
  akebi=$(pgrep -f "thirdparty/Akebi/akebi-https-server --listen-address [^ ]*:${port}")
  [ -n "$akebi" ] && kill $akebi 2>/dev/null && say "Akebi を止めました (pid $akebi)"
  return 0
}

# 起動の前に DB を世代で控える（壊れた時に戻せるように）。video.db は大きいので2世代だけ
backup_dbs() {
  local d db keep bk
  d=$(cd "$SERVER_DIR" && env -u TSTAG_DATA_DIR -u TEXT_PARSER_DATA_DIR "$PY" -c 'import data_paths; print(data_paths.DATA_DIR)' "$CONFIG" 2>/dev/null || echo data)
  case "$d" in /*) ;; *) d="$SERVER_DIR/$d" ;; esac
  for db in rules.db video.db; do
    [ -f "$d/$db" ] || continue
    keep=10; [ "$db" = video.db ] && keep=2
    mkdir -p "$d/_backup"
    bk="$d/_backup/$db.$(date +%Y%m%d_%H%M%S)"
    cp -a "$d/$db" "$bk" && say "控え: $bk"
    ls -1t "$d/_backup/$db".* 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f
  done
}

# 本体を止めて、消えるのを待つ（最大30秒）。DB を書いている途中のプロセスが残ったまま次を起動すると、
# 同じ DB を二重に書いて壊す。待っても消えない時だけ SIGKILL
stop_and_wait() {
  local old i
  old=$(pids_here)
  if [ -n "$old" ]; then
    kill $old && say "止めています (pid $old)"
  fi
  kill_orphan_akebi
  [ -n "$old" ] || return 0
  for i in $(seq 1 30); do
    [ -n "$(pids_here)" ] || { say "止まりました"; return 0; }
    sleep 1
  done
  say "30秒で止まらないので強制終了します: $(pids_here)"
  kill -9 $(pids_here) 2>/dev/null
  sleep 2
}

# 立て直しは1つずつ（見張りや設定画面からの再起動と取り合わないように）
take_lock() {
  local i
  for i in $(seq 1 60); do
    mkdir "$LOCK" 2>/dev/null && { trap 'rmdir "$LOCK" 2>/dev/null' EXIT; return 0; }
    sleep 2
  done
  fail "ほかで立て直しの最中です（$LOCK）"
}

# 開く URL を出す
show_urls() {
  local port https ip
  read -r port _ <<< "$(ports)"
  https=$(awk '/^https:/{f=1} f&&/enabled:[[:space:]]*true/{print 1; exit}' "$SERVER_DIR/$CONFIG")
  # IPv4 だけ。Docker の橋（172.17〜）は外から届かないので出さない
  for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9.]+$' | grep -vE '^172\.(1[7-9]|2[0-9]|3[01])\.'); do
    if [ -n "$https" ]; then
      # Akebi は IP をハイフンでつないだ名前（*.local.konomi.tv）で正規の証明書の HTTPS になる
      echo "  https://$(echo "$ip" | tr '.' '-').local.konomi.tv:${port}/"
    else
      echo "  http://${ip}:${port}/"
    fi
  done | head -5
}
