#!/usr/bin/env bash
# GUI（POST /api/config/restart）から呼ばれる、安全な自己再起動スクリプト。
# scripts/server.sh と同じ安全な手順（旧プロセス消滅確認・DBバックアップ・Akebi孤児掃除）を踏むが、
# pgrep による全killではなく PID 指定にする（同一ホストで動く検証用インスタンス等を巻き込まないため）。
#
# Usage: restart_server.sh <old_pid> <python_bin> <config_path> <port>
set -u

OLD_PID="$1"
PYTHON_BIN="$2"
CONFIG_PATH="$3"
PORT="$4"

cd "$(dirname "$0")/.."   # server/

echo "[restart_server] $(date +%Y%m%d_%H%M%S) old_pid=$OLD_PID python=$PYTHON_BIN config=$CONFIG_PATH port=$PORT"

# systemd のサービス（scripts/install-service.sh）で動いているなら、systemd に起動し直してもらう。
# 本体が止まるとサービスの中のプロセスは全部止められるので、このスクリプトで起動し直すことはできない。
# --no-block で頼むだけにして、止める・控える・起動する（scripts/server.sh prestart）は systemd に任せる
if grep -q 'ts-tag-bridge\.service' "/proc/$OLD_PID/cgroup" 2>/dev/null; then
  if systemctl --user --no-block restart ts-tag-bridge.service; then
    echo "[restart_server] systemd に再起動を頼みました"
    exit 0
  fi
  echo "[restart_server] warn: systemd に頼めませんでした。このスクリプトで起動し直します"
fi

# 旧プロセスの完全終了を待つ（最大30秒）。
# ★重要: 固定 sleep で待ちきれず旧プロセスが生き残ったまま新プロセスが同じ rules.db を
# 開くと、二重書き込みで SQLite DB が破損する。必ず消滅を確認してから起動する。
for i in $(seq 1 30); do
  kill -0 "$OLD_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$OLD_PID" 2>/dev/null; then
  echo "[restart_server] warn: 30秒で終了せず。SIGKILL: $OLD_PID"
  kill -9 "$OLD_PID" 2>/dev/null
  sleep 2
fi

# 旧プロセスが起動した Akebi(子プロセス)も掃除する（SIGTERM では atexit が走らず孤児化するため）。
# このアプリ用の Akebi(--listen-address ...:$PORT) のみ kill。他ポート(KonomiTV用等)は触らない。
AKEBI=$(pgrep -f "thirdparty/Akebi/akebi-https-server --listen-address [^ ]*:${PORT}")
if [ -n "$AKEBI" ]; then
  kill "$AKEBI" 2>/dev/null
  echo "[restart_server] killed akebi pid=$AKEBI"
fi

# データの置き場（config.yml の data_dir。空なら server/data）。設定で変えた直後の再起動でも新しい方を見るよう、
# 引き継いだ環境変数は使わずに読み直す（起動する本体にも引き継がせない）
unset TSTAG_DATA_DIR TEXT_PARSER_DATA_DIR
DATA_DIR=$("$PYTHON_BIN" -c 'import data_paths; print(data_paths.DATA_DIR)' "$CONFIG_PATH" 2>/dev/null || echo data)
unset TSTAG_DATA_DIR TEXT_PARSER_DATA_DIR

# 起動前に rules.db / video.db を世代バックアップ（DB破損時の復旧用。直近10世代を保持）
for DB in "$DATA_DIR/rules.db" "$DATA_DIR/video.db"; do
  if [ -f "$DB" ]; then
    mkdir -p "$DATA_DIR/_backup"
    BK="$DATA_DIR/_backup/$(basename "$DB").$(date +%Y%m%d_%H%M%S)"
    cp -a "$DB" "$BK" 2>/dev/null && echo "[restart_server] backup $BK"
    ls -1t "$DATA_DIR/_backup/$(basename "$DB")".* 2>/dev/null | tail -n +11 | xargs -r rm -f
  fi
done

# ログは scripts/server.sh と同じ所（TSTAG_LOG。既定 /tmp/ts-tag-bridge.log）
LOG="${TSTAG_LOG:-/tmp/ts-tag-bridge.log}"
setsid nohup "$PYTHON_BIN" main.py "$CONFIG_PATH" >> "$LOG" 2>&1 < /dev/null &
NEW_PID=$!
echo "[restart_server] started pid=$NEW_PID"

sleep 3
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[restart_server] ok: new process alive (pid=$NEW_PID)"
else
  echo "[restart_server] error: new process died immediately. see $LOG"
fi
