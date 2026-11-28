#!/usr/bin/env bash
# 電源を入れたら起動し、落ちたら立て直す（systemd の利用者のサービスとして入れる。root は要らない）。
#
#   scripts/install-service.sh            入れて、今すぐ起動する
#   scripts/install-service.sh --remove   外す（サーバーも止まる）
#
# ログインしていない時も動かすには、一度だけ: sudo loginctl enable-linger $USER
# 入れた後の起動・停止・再起動は scripts/server.sh が systemd に頼む（アプリの設定画面からの再起動も同じ）
set -eu
. "$(dirname "$0")/lib.sh"

command -v systemctl >/dev/null || fail "systemctl がありません（systemd の無い環境では scripts/server.sh start で起動してください）"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$SERVICE"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  say "外しました。これからは scripts/server.sh start で手で起動します"
  exit 0
fi

need_setup
# 手で起動した物が動いていれば止めてから（同じ DB を2つで開かないように）
if [ -n "$(pids_here)" ]; then take_lock; stop_and_wait; rmdir "$LOCK" 2>/dev/null; trap - EXIT; fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNIT
[Unit]
Description=ts-tag-bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SERVER_DIR
Environment=TSTAG_CONFIG=$CONFIG
ExecStartPre=$REPO/scripts/server.sh prestart
ExecStart=$PY main.py $CONFIG
# 止める時は本体へ SIGTERM、40 秒待っても残る物（本体が起動した Akebi など）は強制終了
KillMode=mixed
TimeoutStopSec=40
Restart=on-failure
RestartSec=10
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE"
say "入れました: $UNIT"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  say "ログインしていない時（電源を入れた直後）も動かすには、一度だけ: sudo loginctl enable-linger $USER"
fi
sleep 3
systemctl --user --no-pager status "$SERVICE" | head -5
show_urls
