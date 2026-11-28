#!/usr/bin/env bash
# 初めの準備をまとめて流す（何度流してもよい。済んでいる所は飛ばす）。
#
#   scripts/setup.sh              Python の環境・外部ツール・設定ファイル（足りない所は質問する）
#   scripts/setup.sh --akebi      HTTPS の前段（Akebi）も入れる
#
# 質問: 使うエンコーダー（GPU を見て勧める。選んだ物だけ入れる）・EDCB と Amatsukaze の場所・
# 作業とエンコードの置き場・しょぼいカレンダーへ伝える連絡先。答えは server/config.yml に書く（コメントは残す）。質問せずに渡すこともできる:
#   --encoder QSVEncC|NVEncC|VCEEncC|rkmppenc|FFmpeg  --edcb-url URL  --amatsukaze-url URL
#   --tmp DIR  --encode-dir DIR（何度でも）  --shoboi-contact URL
# 終わったら scripts/server.sh start（または scripts/install-service.sh で自動起動）
set -eu
. "$(dirname "$0")/lib.sh"

AKEBI=; CONF_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --akebi) AKEBI=1 ;;
    --encoder|--edcb-url|--amatsukaze-url|--tmp|--encode-dir|--shoboi-contact)
      [ $# -ge 2 ] || fail "$1 には値が要ります"
      CONF_ARGS+=("$1" "$2"); shift ;;
    *) sed -n '2,12p' "$0"; exit 1 ;;
  esac
  shift
done

command -v python3 >/dev/null || fail "python3 がありません（3.12 以上）"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))' || fail "Python 3.12 以上が要ります（今は $(python3 --version)）"

# 1. Python の環境
if [ ! -x "$PY" ]; then
  say "Python の環境を作ります（server/.venv）"
  python3 -m venv "$SERVER_DIR/.venv"
fi
# TS を読む部品（read_tsprogram）は別リポジトリ。Python の部品の一覧が読むので先に取る
INSTALL="$SERVER_DIR/thirdparty/install.sh"
bash "$INSTALL" --readtsprogram
say "Python の部品を入れます"
"$PY" -m pip install -q --upgrade pip
"$PY" -m pip install -q -r "$SERVER_DIR/requirements.txt"

# 2. 設定ファイル（無い時だけ。あれば触らない）
if [ ! -f "$SERVER_DIR/$CONFIG" ]; then
  cp "$SERVER_DIR/config.yml.example" "$SERVER_DIR/$CONFIG"
  say "server/$CONFIG を作りました"
fi
# 足りない所を聞いて書く。選んだエンコーダーを入れる install.sh の指定が返る
HWENC=$("$PY" "$REPO/scripts/configure" --config "$SERVER_DIR/$CONFIG" ${CONF_ARGS[@]+"${CONF_ARGS[@]}"})

# 3. 外部ツール（FFmpeg・tsreadex など。版は install.sh で固定してある。ログインの署名の鍵が空なら作る）
bash "$INSTALL" --core
bash "$INSTALL" --biim
bash "$INSTALL" --cmcut
[ -z "$AKEBI" ] || bash "$INSTALL" --akebi
[ -z "$HWENC" ] || bash "$INSTALL" "$HWENC"

bash "$INSTALL" --status || true

# 4. Web 版（ブラウザで見るアプリ）をビルドして、サーバーが配る dist を作る
#    node か Docker があればビルド。無ければスキップ。失敗してもサーバー準備は止めない
if command -v node >/dev/null 2>&1 || command -v docker >/dev/null 2>&1; then
  say "Web 版をビルドします"
  if bash "$REPO/scripts/build-web.sh"; then
    say "Web 版の dist を用意しました: $REPO/apps/app/dist"
  else
    say "Web 版のビルドに失敗しました。サーバーは起動できます。後で scripts/build-web.sh を流してください"
  fi
else
  say "node/Docker がないので Web 版のビルドはスキップしました。必要なら scripts/build-web.sh を流してください"
fi

say "準備ができました: scripts/server.sh start（自動起動にするなら scripts/install-service.sh）"
