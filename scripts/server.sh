#!/usr/bin/env bash
# サーバーの起動・停止・再起動・状態・ログ。
#
#   scripts/server.sh start     起動（DB を控えてから）
#   scripts/server.sh stop      停止（止まるのを待つ）
#   scripts/server.sh restart   止めて起動し直す
#   scripts/server.sh status    動いているか・開く URL
#   scripts/server.sh log       ログを流して見る（Ctrl+C で抜ける）
#
# install-service.sh で systemd に入れてあれば、start / stop / restart は systemd に頼む
# （電源を入れた時の起動・落ちた時の立て直しも systemd がやる）。
# 設定ファイルは TSTAG_CONFIG（既定 config.yml。server/ の中）、ログは TSTAG_LOG（既定 /tmp/ts-tag-bridge.log）
set -u
. "$(dirname "$0")/lib.sh"

start() {
  backup_dbs
  kill_orphan_akebi
  # 起動したシェル（ターミナル・ssh）から切り離す。閉じても巻き添えにならない
  (cd "$SERVER_DIR" && setsid nohup "$PY" main.py "$CONFIG" >> "$LOG" 2>&1 < /dev/null &)
  sleep 3
  local pid; pid=$(pids_here)
  [ -n "$pid" ] || fail "起動してすぐ止まりました。ログを見てください: tail -n 50 $LOG"
  say "起動しました (pid $pid)。ログ: $LOG"
  show_urls
}

cmd="${1:-}"
case "$cmd" in
  start|stop|restart) need_setup ;;
esac

if service_installed && [[ "$cmd" =~ ^(start|stop|restart)$ ]]; then
  systemctl --user "$cmd" "$SERVICE" && say "systemd で ${cmd} しました（systemctl --user status $SERVICE）"
  [ "$cmd" = stop ] || show_urls
  exit 0
fi

case "$cmd" in
  start)
    [ -z "$(pids_here)" ] || fail "もう動いています (pid $(pids_here))。起動し直すなら restart"
    take_lock; start ;;
  stop)
    take_lock; stop_and_wait ;;
  restart)
    take_lock; stop_and_wait; start ;;
  status)
    if service_installed; then systemctl --user --no-pager status "$SERVICE" | head -5; fi
    pid=$(pids_here)
    if [ -n "$pid" ]; then say "動いています (pid $pid)"; show_urls; else say "止まっています"; fi ;;
  log)
    tail -n 100 -F "$LOG" ;;
  prestart)
    # systemd が起動の前に呼ぶ（DB の控えと Akebi の残りの片付け）
    backup_dbs; kill_orphan_akebi ;;
  *)
    sed -n '2,13p' "$0"; exit 1 ;;
esac
