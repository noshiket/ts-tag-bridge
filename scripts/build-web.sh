#!/usr/bin/env bash
# Web 版（アプリ）をビルドして、サーバーが配る dist を更新する。
# ホストに Node/npm があればそれを使い、無ければ Docker（既定 node:20）で
# 依存の導入とビルドを行う。
#
#   scripts/build-web.sh
#
# 依存の導入は node_modules が無い時だけ。package-lock.json があれば npm ci、
# 無ければ npm install を使う。Docker のイメージは
# TSTAG_WEB_BUILD_IMAGE（既定: node:20）で変えられる。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/app"
WORKSPACE="$ROOT"
IMAGE="${TSTAG_WEB_BUILD_IMAGE:-node:20}"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "Web 版のアプリがありません: $APP_DIR" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  if [ ! -d "$WORKSPACE/node_modules" ]; then
    if [ -f "$WORKSPACE/package-lock.json" ]; then
      (cd "$WORKSPACE" && npm ci)
    else
      (cd "$WORKSPACE" && npm install)
    fi
  fi
  (cd "$WORKSPACE" && CI=1 EXPO_NO_TELEMETRY=1 npm run export:web -w @tstag/app)
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "Node/npm も Docker もありません。どちらかを用意してください。" >&2
    exit 1
  fi
  if [ ! -d "$WORKSPACE/node_modules" ]; then
    if [ -f "$WORKSPACE/package-lock.json" ]; then
      docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 -e EXPO_NO_TELEMETRY=1 \
        -v "$ROOT:/work" -w /work "$IMAGE" npm ci
    else
      docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 -e EXPO_NO_TELEMETRY=1 \
        -v "$ROOT:/work" -w /work "$IMAGE" npm install
    fi
  fi
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 -e EXPO_NO_TELEMETRY=1 \
    -v "$ROOT:/work" -w /work "$IMAGE" npm run export:web -w @tstag/app
fi

if [ ! -f "$APP_DIR/dist/index.html" ]; then
  echo "ビルド後の dist/index.html がありません: $APP_DIR/dist" >&2
  exit 1
fi
echo "ビルドしました: $APP_DIR/dist"
ls -la --time-style=long-iso "$APP_DIR/dist/index.html"
