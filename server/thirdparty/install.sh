#!/usr/bin/env bash
# =============================================================================
# thirdparty/install.sh
# ストリーミング機能に必要なサードパーティバイナリをインストールする
#
# Usage:
#   ./install.sh              # コア (FFmpeg + tsreadex + psisiarc)
#   ./install.sh --all        # コア + HW エンコーダー
#   ./install.sh --ffmpeg     # FFmpeg のみ
#   ./install.sh -h           # ヘルプ
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="${SCRIPT_DIR}/.tmp_build"

# ─────────────────── バージョン固定 ───────────────────
# サーバーごとに版が違うと、同じ操作でも片方だけ失敗する。実際 FFmpeg を latest で
# 取っていたため1台だけ FFmpeg 8 系が入り、-vsync が削除されていて静止フレームが
# 全て 500 になった。新しくサーバーを立てたときも同じことが起きるので、取得元が
# 「最新」を指すものは全て固定する。上げるときは全サーバーで入れ直すこと。
FFMPEG_BUILD="autobuild-2026-06-10-12-58"
TSREADEX_COMMIT="a82528ccb698fcd07b4da1bb2243e63d685c34a7"
PSISIARC_COMMIT="6593a0f63aedaaecfac7682b51e267874a8ec549"
PSISIMUX_COMMIT="18c3c020e51e16804340c834835e0cfd72c8b50d"
READ_TSPROGRAM_COMMIT="fa4445f40c3058ddc569dc6e0ce0a1f508f1a7ed"
AKEBI_COMMIT="8ddba6a29b858567ab286b5d31daebf2ff683e94"
QSVENCC_TAG="8.27"
NVENCC_TAG="9.32"
VCEENCC_TAG="9.12"
RKMPPENC_TAG="0.19"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC}  $*" >&2; }
step()  { echo -e "${CYAN}[...]${NC} $*"; }

cleanup() { [[ -d "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR" || true; }
trap cleanup EXIT

need_cmd() {
    for cmd in "$@"; do
        if ! command -v "$cmd" &>/dev/null; then
            error "'$cmd' が見つかりません。apt install してください。"
            exit 1
        fi
    done
}

# ─────────────────── jwt_secret (config.yml) ───────────────────
# 未設定(空文字 or 既定値のまま)だとログイン時に jwt.exceptions.InvalidKeyError:
# HMAC key must not be empty で500エラーになる。新規サーバー(config.yml.example から
# コピーしただけ)でハマりやすいため、install.sh 実行時に毎回チェックし、未設定なら
# ランダム生成して埋める。既に値が入っていれば絶対に上書きしない。
check_jwt_secret() {
    local config="${SCRIPT_DIR}/../config.yml"
    if [[ ! -f "$config" ]]; then
        warn "jwt_secret: config.yml が見つかりません (config.yml.example をコピーして作成してください)"
        return 0
    fi
    local current
    current="$(sed -nE 's/^jwt_secret:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' "$config" | head -1)"
    if [[ -n "$current" && "$current" != "ea_default_secret_change_me" ]]; then
        info "jwt_secret: 設定済み"
        return 0
    fi

    need_cmd openssl
    step "jwt_secret: 未設定のためランダム生成..."
    local secret
    secret="$(openssl rand -hex 32)"
    sed -i.bak -E "s#^jwt_secret:.*#jwt_secret: \"${secret}\"#" "$config"
    rm -f "${config}.bak"
    info "jwt_secret: 生成・設定しました(反映にはサーバー再起動が必要です)"
}

# ─────────────────── tsreadex ───────────────────
install_tsreadex() {
    local dest="${SCRIPT_DIR}/tsreadex/tsreadex"
    if [[ -x "$dest" ]]; then info "tsreadex: インストール済み"; return 0; fi

    need_cmd git make g++
    step "tsreadex: ソースからビルド中..."
    local d="${TEMP_DIR}/tsreadex"
    # バージョン固定 (副音声分離 -a +8 を含む)
    local commit="$TSREADEX_COMMIT"
    git init -q "$d"
    git -C "$d" remote add origin https://github.com/xtne6f/tsreadex.git
    git -C "$d" fetch -q --depth 1 origin "$commit"
    git -C "$d" checkout -q FETCH_HEAD
    make -C "$d" -j"$(nproc)" >/dev/null 2>&1
    mkdir -p "${SCRIPT_DIR}/tsreadex"
    cp "$d/tsreadex" "$dest" && chmod +x "$dest"
    info "tsreadex: $dest"
}

# ─────────────────── CM 解析（logoframe_py / chapterexe_py / joinlogoscp_py）───────────────────
# CM カットの3段（ロゴ判定 → 無音+シーンチェンジ検出 → 構成推測）。それぞれ原典の Python 移植で、
# 別リポジトリとして公開している。本体には同梱せず、ここへ別途入れる
# （取得元の既定は下の GitHub。環境変数で別の場所を渡すこともできる）。
#   logoframe_py   … Amatsukaze のロゴ判定の移植（MIT）
#   chapterexe_py  … rigaya/chapter_exe の移植（GPL-2.0。本体からは別プロセスとして起動するだけ）
#   joinlogoscp_py … yobibi/join_logo_scp の移植（原典の作者の許諾表明に従う）
# 詳細は各リポジトリの README と、リポジトリ直下の THIRD-PARTY-NOTICES.md を参照。
install_py_port() {
    local name="$1" marker="$2" repo_var="$3" opt="$4" license="$5" what="$6" default_repo="$7"
    local dest="${SCRIPT_DIR}/${name}"
    local repo="${!repo_var:-$default_repo}"
    if [[ -f "$dest/$marker" ]]; then info "${name}: インストール済み"; return 0; fi

    if [[ -z "$repo" ]]; then
        error "${name} の取得元が設定されていません"
        echo "  本体には同梱していません。次のどちらかで入れてください:" >&2
        echo "    ${repo_var}=<git URL> $0 ${opt}" >&2
        echo "    もしくは ${dest}/ へ直接配置" >&2
        echo "  未導入でも動きますが、CMカットの${what}だけ使えません。" >&2
        return 1
    fi

    need_cmd git
    step "${name}: 取得中..."
    local d="${TEMP_DIR}/${name}"
    rm -rf "$d"
    git clone -q --depth 1 "$repo" "$d"
    rm -rf "$dest"
    mkdir -p "$dest"
    cp "$d"/*.py "$dest/"
    local f
    for f in LICENSE LICENSE-MIT NOTICE README.md; do
        [[ -f "$d/$f" ]] && cp "$d/$f" "$dest/"
    done
    info "${name}: $dest (${license})"
}

install_logoframe()  { install_py_port logoframe_py   logo_frame.py  LOGOFRAME_PY_REPO   --logoframe   MIT                   "ロゴ判定" \
                         https://github.com/noshiket/logoframe_py.git; }
install_chapterexe() { install_py_port chapterexe_py  chapter_exe.py CHAPTEREXE_PY_REPO  --chapterexe  GPL-2.0               "無音+シーンチェンジ検出" \
                         https://github.com/noshiket/chapterexe_py.git; }
install_joinlogoscp() { install_py_port joinlogoscp_py jls_top.py    JOINLOGOSCP_PY_REPO --joinlogoscp "原典の作者の許諾表明" "構成推測" \
                         https://github.com/noshiket/joinlogoscp_py.git; }

# ─────────────────── read_tsprogram（TS から番組情報・字幕・ロゴなどを読む。本体が使う） ───────────────────
# 別リポジトリとして公開している。固定した版を git のまま置き（直して出し直せるように）、venv へ -e で入れる
install_readtsprogram() {
    local dest="${SCRIPT_DIR}/read_tsprogram"
    local repo="${READ_TSPROGRAM_REPO:-https://github.com/noshiket/read_tsprogram.git}"
    if [[ -d "$dest/.git" ]]; then
        if [[ "$(git -C "$dest" rev-parse HEAD 2>/dev/null)" == "$READ_TSPROGRAM_COMMIT" ]]; then
            info "read_tsprogram: インストール済み"
        elif [[ -n "$(git -C "$dest" status --porcelain 2>/dev/null)" ]]; then
            warn "read_tsprogram: 手元で直した所があるので入れ替えません ($dest)"
        else
            step "read_tsprogram: 固定の版へそろえています..."
            git -C "$dest" fetch -q origin "$READ_TSPROGRAM_COMMIT" && git -C "$dest" checkout -q "$READ_TSPROGRAM_COMMIT"
            info "read_tsprogram: $READ_TSPROGRAM_COMMIT"
        fi
    else
        need_cmd git
        step "read_tsprogram: 取得中..."
        local d="${TEMP_DIR}/read_tsprogram"
        rm -rf "$d"
        git init -q "$d"
        git -C "$d" remote add origin "$repo"
        git -C "$d" fetch -q --depth 1 origin "$READ_TSPROGRAM_COMMIT"
        git -C "$d" checkout -q FETCH_HEAD
        # 前に同梱していた物（git でない）は消して置き換える。作った egg-info なども一緒に消える
        rm -rf "$dest"
        mv "$d" "$dest"
        info "read_tsprogram: $dest (MIT)"
    fi
    # venv があれば入れる（無ければ server/requirements.txt を入れる時に入る）
    local pip="${SCRIPT_DIR}/../.venv/bin/pip"
    if [[ -x "$pip" ]] && ! "$pip" show read_tsprogram &>/dev/null; then
        (cd "${SCRIPT_DIR}/.." && "$pip" install -q -e ./thirdparty/read_tsprogram --config-settings editable_mode=compat) \
            && info "read_tsprogram: venv へ入れました"
    fi
}

# ─────────────────── psisiarc ───────────────────
install_psisiarc() {
    local dest="${SCRIPT_DIR}/psisiarc/psisiarc"
    if [[ -x "$dest" ]]; then info "psisiarc: インストール済み"; return 0; fi

    need_cmd git make g++
    step "psisiarc: ソースからビルド中..."
    local d="${TEMP_DIR}/psisiarc"
    git init -q "$d"
    git -C "$d" remote add origin https://github.com/xtne6f/psisiarc.git
    git -C "$d" fetch -q --depth 1 origin "$PSISIARC_COMMIT"
    git -C "$d" checkout -q FETCH_HEAD
    make -C "$d" -j"$(nproc)" >/dev/null 2>&1
    mkdir -p "${SCRIPT_DIR}/psisiarc"
    cp "$d/psisiarc" "$dest" && chmod +x "$dest"
    info "psisiarc: $dest"
}

# ─────────────────── psisimux ───────────────────
install_psisimux() {
    local dest="${SCRIPT_DIR}/psisimux/psisimux"
    if [[ -x "$dest" ]]; then info "psisimux: インストール済み"; return 0; fi

    need_cmd git make g++
    step "psisimux: ソースからビルド中..."
    local d="${TEMP_DIR}/psisimux"
    git init -q "$d"
    git -C "$d" remote add origin https://github.com/xtne6f/psisimux.git
    git -C "$d" fetch -q --depth 1 origin "$PSISIMUX_COMMIT"
    git -C "$d" checkout -q FETCH_HEAD
    make -C "$d" -j"$(nproc)" >/dev/null 2>&1
    mkdir -p "${SCRIPT_DIR}/psisimux"
    cp "$d/psisimux" "$dest" && chmod +x "$dest"
    info "psisimux: $dest"
}

# ─────────────────── biim (Python wheel, 録画再生の HLS muxing 用) ───────────────────
install_biim() {
    # biim は PyPI 未公開のため tsukumijima 氏フォークの wheel を venv に pip install する
    local wheel="https://github.com/tsukumijima/biim/releases/download/v1.11.0-post1/biim-1.11.0.post1-py3-none-any.whl"
    local pip="${SCRIPT_DIR}/../.venv/bin/pip"
    [[ -x "$pip" ]] || pip="$(command -v pip3 || command -v pip || true)"
    if [[ -z "$pip" ]]; then warn "biim: pip が見つかりません。スキップします。"; return 0; fi
    if "$pip" show biim &>/dev/null; then info "biim: インストール済み"; return 0; fi
    step "biim: wheel をインストール中..."
    if "$pip" install "$wheel" >/dev/null 2>&1; then
        info "biim: インストール完了"
    else
        warn "biim: インストールに失敗しました"
    fi
}

# ─────────────────── Akebi (HTTPS/HTTP2 リバースプロキシ, Go製) ───────────────────
install_akebi() {
    local dest="${SCRIPT_DIR}/Akebi/akebi-https-server"
    if [[ -x "$dest" ]]; then info "Akebi: インストール済み"; return 0; fi

    need_cmd git go
    step "Akebi: ソースからビルド中..."
    local d="${TEMP_DIR}/Akebi"
    git init -q "$d"
    git -C "$d" remote add origin https://github.com/tsukumijima/Akebi.git
    git -C "$d" fetch -q --depth 1 origin "$AKEBI_COMMIT"
    git -C "$d" checkout -q FETCH_HEAD
    # net/http の HTTP アクセス時 HTML を HTTPS 自動リダイレクトに置換する任意パッチ。
    # GOROOT への書き込み権限が要るため失敗し得るが、ビルド/動作には影響しないのでスキップ可。
    bash "$d/replace_net_http.sh" >/dev/null 2>&1 || warn "Akebi: net/http パッチをスキップ (機能には影響なし)"
    ( cd "$d" && go build -ldflags="-s -w" -o akebi-https-server ./https-server/ ) >/dev/null 2>&1
    mkdir -p "${SCRIPT_DIR}/Akebi"
    cp "$d/akebi-https-server" "$dest" && chmod +x "$dest"
    info "Akebi: $dest"
}

# ─────────────────── FFmpeg (BtbN static build) ───────────────────
install_ffmpeg() {
    local dest_ff="${SCRIPT_DIR}/FFmpeg/ffmpeg"
    local dest_fp="${SCRIPT_DIR}/FFmpeg/ffprobe"
    if [[ -x "$dest_ff" && -x "$dest_fp" && "${FORCE_FFMPEG:-false}" != true ]]; then
        info "FFmpeg: インストール済み ($("$dest_ff" -version 2>/dev/null | head -1 | cut -d" " -f3))"
        return 0
    fi

    need_cmd curl tar
    step "FFmpeg: BtbN static build をダウンロード中... (${FFMPEG_BUILD})"
    # バージョン固定: 再現性のため特定ビルドにピン留めする(tsreadex と同じ方針)。
    # 以前は latest(master ローリング)を取っていたため、導入した時期でサーバーごとに
    # 中身が変わっていた。実際に 2026-07-03 以降のビルドは FFmpeg 8 系で -vsync が
    # 削除されており、静止フレーム取得が全て 500 になっていた
    # (Unrecognized option 'vsync' / 1台のみ再現)。
    local url="https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILD}/ffmpeg-master-latest-linux64-gpl.tar.xz"
    local archive="${TEMP_DIR}/ffmpeg.tar.xz"
    curl -fSL --progress-bar -o "$archive" "$url"

    step "FFmpeg: 展開中..."
    tar -xf "$archive" -C "$TEMP_DIR"
    local extracted
    extracted="$(find "$TEMP_DIR" -maxdepth 1 -name 'ffmpeg-*' -type d | head -1)"
    mkdir -p "${SCRIPT_DIR}/FFmpeg"
    cp "${extracted}/bin/ffmpeg"  "$dest_ff"
    cp "${extracted}/bin/ffprobe" "$dest_fp"
    chmod +x "$dest_ff" "$dest_fp"
    info "FFmpeg: $dest_ff"
    info "FFprobe: $dest_fp"
}

# ─────────────────── HW Encoder (.deb from rigaya) ───────────────────
#
# rigaya の GitHub Releases から Ubuntu 用 .deb をダウンロードし、
# バイナリだけを取り出して thirdparty/ に配置する。
# ドライバやライブラリは別途システムにインストールが必要。
#
install_hwenc_deb() {
    local name="$1"        # QSVEncC / NVEncC / VCEEncC / rkmppenc
    local repo="$2"        # rigaya/QSVEnc etc.
    local bin_name="$3"    # qsvencc / nvencc / vceencc / rkmppenc
    local tag="$4"         # 固定するリリースタグ
    local dest="${SCRIPT_DIR}/${name}/${name}"

    if [[ -x "$dest" ]]; then info "${name}: インストール済み"; return 0; fi

    need_cmd curl ar tar

    step "${name}: リリース ${tag} を取得中..."

    # GitHub API → Ubuntu24.04 or Ubuntu22.04 の amd64.deb を探す
    local releases_json="${TEMP_DIR}/${name}_releases.json"
    curl -fsSL "https://api.github.com/repos/${repo}/releases/tags/${tag}" -o "$releases_json" 2>/dev/null || {
        warn "${name}: リリース情報の取得に失敗しました。スキップします。"
        return 0
    }

    local deb_url=""
    # Ubuntu24.04 amd64 を優先、なければ Ubuntu22.04
    for pattern in "Ubuntu24.04_amd64.deb" "Ubuntu22.04_amd64.deb" "amd64.deb"; do
        deb_url="$(grep -oP '"browser_download_url":\s*"\K[^"]*'"${pattern}"'[^"]*' "$releases_json" | head -1)" || true
        [[ -n "$deb_url" ]] && break
    done

    if [[ -z "$deb_url" ]]; then
        warn "${name}: Linux amd64 .deb が見つかりません。スキップします。"
        return 0
    fi

    step "${name}: ダウンロード中... $(basename "$deb_url")"
    local deb_file="${TEMP_DIR}/${name}.deb"
    curl -fSL --progress-bar -o "$deb_file" "$deb_url"

    # .deb からバイナリを抽出
    local extract_dir="${TEMP_DIR}/${name}_deb"
    mkdir -p "$extract_dir"
    (cd "$extract_dir" && ar x "$deb_file" 2>/dev/null)

    local data_tar
    data_tar="$(find "$extract_dir" -name 'data.tar.*' | head -1)"
    if [[ -z "$data_tar" ]]; then
        warn "${name}: .deb 内に data.tar が見つかりません。スキップします。"
        return 0
    fi
    tar -xf "$data_tar" -C "$extract_dir"

    local found_bin
    found_bin="$(find "$extract_dir" -name "$bin_name" -type f | head -1)" || true
    if [[ -z "$found_bin" ]]; then
        warn "${name}: バイナリ '${bin_name}' が .deb 内に見つかりません。スキップします。"
        return 0
    fi

    mkdir -p "${SCRIPT_DIR}/${name}"
    cp "$found_bin" "$dest" && chmod +x "$dest"
    info "${name}: $dest"
}

# ─────────────────── Main ───────────────────

usage() {
    cat <<'EOF'
Usage: install.sh [OPTIONS]

ストリーミング機能に必要なサードパーティバイナリをインストールします。

Options:
  (なし), --core   コア機能 (read_tsprogram + FFmpeg + tsreadex + psisiarc + psisimux) [デフォルト]
  --all            全てインストール (コア + HW エンコーダー)
  --ffmpeg         FFmpeg のみ
  --reinstall-ffmpeg  FFmpeg を入れ直す (固定版へ揃えたいとき)
  --readtsprogram  read_tsprogram のみ (TS から番組情報・字幕などを読む。本体が使う)
  --tsreadex       tsreadex のみ
  --psisiarc       psisiarc のみ
  --psisimux       psisimux のみ
  --hwenc          HW エンコーダーのみ (QSVEncC, NVEncC, VCEEncC, rkmppenc)
  --qsvencc        QSVEncC のみ
  --nvencc         NVEncC のみ
  --vceencc        VCEEncC のみ
  --rkmppenc       rkmppenc のみ
  --akebi          Akebi のみ (HTTPS/HTTP2 リバースプロキシ, Go製)
  --biim           biim のみ (録画再生の HLS muxing 用 Python wheel)
  --cmcut          CMカットの3つ（下の3つ）をまとめて入れる
  --logoframe      logoframe_py のみ (CMカットのロゴ判定)
  --chapterexe     chapterexe_py のみ (CMカットの無音+シーンチェンジ検出。GPL-2.0)
  --joinlogoscp    joinlogoscp_py のみ (CMカットの構成推測)
                   3つとも github.com/noshiket/ から取る（*_PY_REPO で取得元を変えられる）
  --status         インストール状況を表示
  -h, --help       このヘルプを表示

Examples:
  ./install.sh                 # コア機能をインストール
  ./install.sh --all           # 全てインストール
  ./install.sh --qsvencc       # QSVEncC のみインストール
  ./install.sh --cmcut         # CMカットの3つ
  ./install.sh --status        # 現在の状況確認

Note:
  QSVEncC/NVEncC/VCEEncC などの HW エンコーダーを使う場合、
  実行ユーザーが 'render' および 'video' グループに所属している必要があります。
  所属していない場合は --status で警告が表示されます。

    sudo usermod -aG render,video \$USER
    # ログアウト→ログインし直すと反映されます
EOF
}

show_status() {
    echo ""
    echo "=== thirdparty バイナリ状況 ==="
    echo ""
    # 固定しているバージョン。サーバー間でズレていないか見比べられるように出す
    echo "  固定バージョン: FFmpeg ${FFMPEG_BUILD} / QSVEncC ${QSVENCC_TAG} /"
    echo "                  NVEncC ${NVENCC_TAG} / VCEEncC ${VCEENCC_TAG} / rkmppenc ${RKMPPENC_TAG}"
    local ff="${SCRIPT_DIR}/FFmpeg/ffmpeg"
    if [[ -x "$ff" ]]; then
        echo "  実際の FFmpeg : $("$ff" -version 2>/dev/null | head -1 | cut -d" " -f3)"
    fi
    echo ""
    local bins=(
        "tsreadex/tsreadex:tsreadex:必須"
        "psisiarc/psisiarc:psisiarc:推奨"
        "psisimux/psisimux:psisimux:推奨(MP4再生)"
        "FFmpeg/ffmpeg:FFmpeg:必須"
        "FFmpeg/ffprobe:FFprobe:任意"
        "QSVEncC/QSVEncC:QSVEncC:任意(Intel GPU)"
        "NVEncC/NVEncC:NVEncC:任意(NVIDIA GPU)"
        "VCEEncC/VCEEncC:VCEEncC:任意(AMD GPU)"
        "rkmppenc/rkmppenc:rkmppenc:任意(Rockchip)"
        "Akebi/akebi-https-server:Akebi:任意(HTTPS/HTTP2)"
    )
    for entry in "${bins[@]}"; do
        IFS=':' read -r path label note <<< "$entry"
        local full="${SCRIPT_DIR}/${path}"
        if [[ -x "$full" ]]; then
            echo -e "  ${GREEN}[OK]${NC}  ${label}  (${note})"
        else
            echo -e "  ${RED}[--]${NC}  ${label}  (${note})"
        fi
    done
    # read_tsprogram（git のまま置く。固定の版と違えば出す）
    local rtp="${SCRIPT_DIR}/read_tsprogram"
    if [[ -d "$rtp/.git" ]]; then
        local head; head="$(git -C "$rtp" rev-parse HEAD 2>/dev/null)"
        if [[ "$head" == "$READ_TSPROGRAM_COMMIT" ]]; then
            echo -e "  ${GREEN}[OK]${NC}  read_tsprogram  (必須)"
        else
            echo -e "  ${YELLOW}[!!]${NC}  read_tsprogram  (必須。固定の版と違う: ${head:0:12})"
        fi
    else
        echo -e "  ${RED}[--]${NC}  read_tsprogram  (必須。install.sh --readtsprogram)"
    fi
    # biim は Python パッケージなので venv の pip で確認する
    local pip="${SCRIPT_DIR}/../.venv/bin/pip"
    [[ -x "$pip" ]] || pip="$(command -v pip3 || command -v pip || true)"
    if [[ -n "$pip" ]] && "$pip" show biim &>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC}  biim  (任意(録画再生))"
    else
        echo -e "  ${RED}[--]${NC}  biim  (任意(録画再生))"
    fi

    # config.yml
    echo ""
    echo "=== config.yml ==="
    echo ""
    local config="${SCRIPT_DIR}/../config.yml"
    if [[ ! -f "$config" ]]; then
        echo -e "  ${RED}[--]${NC}  config.yml が見つかりません (config.yml.example をコピーして作成)"
    else
        local current
        current="$(sed -nE 's/^jwt_secret:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' "$config" | head -1)"
        if [[ -n "$current" && "$current" != "ea_default_secret_change_me" ]]; then
            echo -e "  ${GREEN}[OK]${NC}  jwt_secret  (設定済み)"
        else
            echo -e "  ${RED}[--]${NC}  jwt_secret  (未設定。install.sh 実行で自動生成されます)"
        fi
    fi

    # HW エンコーダー利用に必要なグループ
    echo ""
    echo "=== HW エンコーダー用グループ ==="
    echo ""
    local current_user="${SUDO_USER:-$(whoami)}"
    for grp in render video; do
        if id -nG "$current_user" 2>/dev/null | grep -qw "$grp"; then
            echo -e "  ${GREEN}[OK]${NC}  $current_user が '$grp' グループに所属"
        else
            echo -e "  ${RED}[--]${NC}  $current_user が '$grp' グループに未所属"
            echo -e "         → sudo usermod -aG $grp $current_user  (反映にはログインし直しが必要)"
        fi
    done
    echo ""
}

main() {
    local do_ffmpeg=false do_tsreadex=false do_psisiarc=false do_psisimux=false
    local do_qsvencc=false do_nvencc=false do_vceencc=false do_rkmppenc=false
    local do_akebi=false do_biim=false do_status=false do_chapterexe=false
    local do_logoframe=false do_joinlogoscp=false do_readtsprogram=false

    # 引数なし → core
    if [[ $# -eq 0 ]]; then
        do_ffmpeg=true; do_tsreadex=true; do_psisiarc=true; do_psisimux=true; do_biim=true; do_readtsprogram=true
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all)
                do_ffmpeg=true; do_tsreadex=true; do_psisiarc=true; do_psisimux=true
                do_qsvencc=true; do_nvencc=true; do_vceencc=true; do_rkmppenc=true
                do_akebi=true; do_biim=true; do_chapterexe=true; do_readtsprogram=true
                do_logoframe=true; do_joinlogoscp=true ;;
            --core)
                do_ffmpeg=true; do_tsreadex=true; do_psisiarc=true; do_psisimux=true; do_biim=true; do_readtsprogram=true ;;
            --ffmpeg)    do_ffmpeg=true ;;
            --reinstall-ffmpeg) do_ffmpeg=true; FORCE_FFMPEG=true ;;
            --readtsprogram) do_readtsprogram=true ;;
            --tsreadex)  do_tsreadex=true ;;
            --psisiarc)  do_psisiarc=true ;;
            --psisimux)  do_psisimux=true ;;
            --hwenc)
                do_qsvencc=true; do_nvencc=true; do_vceencc=true; do_rkmppenc=true ;;
            --qsvencc)   do_qsvencc=true ;;
            --nvencc)    do_nvencc=true ;;
            --vceencc)   do_vceencc=true ;;
            --rkmppenc)  do_rkmppenc=true ;;
            --akebi)     do_akebi=true ;;
            --biim)      do_biim=true ;;
            --cmcut)     do_logoframe=true; do_chapterexe=true; do_joinlogoscp=true ;;
            --logoframe) do_logoframe=true ;;
            --chapterexe) do_chapterexe=true ;;
            --joinlogoscp) do_joinlogoscp=true ;;
            --status)    do_status=true ;;
            -h|--help)   usage; exit 0 ;;
            *)           error "不明なオプション: $1"; usage; exit 1 ;;
        esac
        shift
    done

    if "$do_status"; then show_status; exit 0; fi

    echo ""
    echo "========================================"
    echo "  thirdparty installer"
    echo "  Target: ${SCRIPT_DIR}"
    echo "========================================"
    echo ""

    mkdir -p "$TEMP_DIR"

    check_jwt_secret

    $do_readtsprogram && install_readtsprogram
    $do_tsreadex  && install_tsreadex
    $do_psisiarc  && install_psisiarc
    $do_psisimux  && install_psisimux
    $do_logoframe && { install_logoframe || true; }
    $do_chapterexe && { install_chapterexe || true; }
    $do_joinlogoscp && { install_joinlogoscp || true; }
    $do_ffmpeg    && install_ffmpeg
    $do_qsvencc  && install_hwenc_deb QSVEncC rigaya/QSVEnc qsvencc "$QSVENCC_TAG"
    $do_nvencc   && install_hwenc_deb NVEncC  rigaya/NVEnc   nvencc "$NVENCC_TAG"
    $do_vceencc  && install_hwenc_deb VCEEncC rigaya/VCEEnc  vceencc "$VCEENCC_TAG"
    $do_rkmppenc && install_hwenc_deb rkmppenc rigaya/rkmppenc rkmppenc "$RKMPPENC_TAG"
    $do_akebi    && install_akebi
    $do_biim     && install_biim

    show_status
    info "完了"
}

main "$@"
