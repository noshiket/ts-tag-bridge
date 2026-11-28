# サードパーティ・ノーティス

本プロジェクトが同梱、または移植して利用しているソフトウェアの著作権表示とライセンスです。
区分と背景は [README.md の「ライセンスについて」](README.md#ライセンスについて) を参照してください。

ライセンス全文は `server/static/vendor/licenses/` に置いてあります。

---

## 1. 同梱しているライブラリ（`server/static/vendor/`）

### aribb24.js — MIT

```
Copyright (c) 2021 もにょ～ん
```

全文: [`server/static/vendor/licenses/MIT-aribb24.js.txt`](server/static/vendor/licenses/MIT-aribb24.js.txt)
出所: https://github.com/monyone/aribb24.js （v2.0.20）
該当: `server/static/vendor/aribb24.umd.js`

### Danmaku — MIT

```
Copyright (c) 2014 Zhenye Wei
```

全文: [`server/static/vendor/licenses/MIT-Danmaku.txt`](server/static/vendor/licenses/MIT-Danmaku.txt)
出所: https://github.com/weizhenye/Danmaku
該当: `server/static/vendor/danmaku.min.js`

### mpegts.js — Apache License 2.0

上流の `LICENSE` は Apache-2.0 の本文のみで、著作権者の行は入っていません。
mpegts.js は [flv.js](https://github.com/bilibili/flv.js)（Bilibili, Apache-2.0）から
派生しています。

全文: [`server/static/vendor/licenses/Apache-2.0-full.txt`](server/static/vendor/licenses/Apache-2.0-full.txt)
出所: https://github.com/xqq/mpegts.js
（[tsukumijima 氏のフォーク](https://github.com/tsukumijima/mpegts.js) の dist を配置。
ManagedMediaSource による iOS 対応と captions.json 字幕を含む）
該当: `server/static/vendor/mpegts.js`

**変更点の明示（Apache-2.0 4.b）**: `mpegts.js` は上流そのままではなく、tsukumijima 氏の
フォーク（commit `726d91b`）のビルド成果物を配置しています。本プロジェクト側での改変は
していません。

### es6-promise（`mpegts.js` に同梱） — MIT

```
Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors
```

全文: [`server/static/vendor/licenses/MIT-es6-promise.txt`](server/static/vendor/licenses/MIT-es6-promise.txt)
出所: https://github.com/stefanpenner/es6-promise
`server/static/vendor/mpegts.js` のバンドルに含まれているため、こちらも表示が必要です。

---

## 2. 移植したコード

逐語移植は派生著作物にあたるため、原典のライセンスが及びます。各ファイル冒頭にも同じ内容の
ヘッダを入れてあります。CM 解析の3つ（logoframe_py / chapterexe_py / joinlogoscp_py）は
それぞれ別リポジトリとして公開しており、本リポジトリには含まれません
（`server/thirdparty/install.sh --cmcut` がユーザーの環境へ入れます）。

### chapterexe_py — GNU General Public License v2.0（**本リポジトリには含まれません**）

```
chapter_exe
Copyright (c) rigaya
https://github.com/rigaya/chapter_exe  (@32880d45)
```

本体を MIT に保つため、この移植は**別リポジトリへ分離**してあります。
`server/thirdparty/install.sh --chapterexe` がユーザーの環境へ入れ、本体からは
`python -m chapterexe_py` として**別プロセスで起動**するだけです。

全文は https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
（導入すると `server/thirdparty/chapterexe_py/LICENSE` にも入ります）

### logoframe_py — MIT（**本リポジトリには含まれません**）

```
Amatsukaze (AMTLogo / LogoScan / AMTSource)
Copyright (c) 2017-2019 Nekopanda
https://github.com/nekopanda/Amatsukaze
```

Amatsukaze はプロジェクト全体としては GPL ですが、それは同梱している GPL ライブラリ
（FFmpeg / FAAD2 / join_logo_scp）によるものです。移植元の 3 ファイルはいずれも冒頭で
MIT を宣言しており、本プロジェクトはそれらのソースだけを移植しています。

`LogoScan` には「`approxim_line()`, `GetAB()`, `med_average()` は MakKi 氏の透過性ロゴ
フィルタプラグイン（https://github.com/makiuchi-d/delogo-aviutl）より拝借」という但し書きが
ありますが、**この 3 関数は移植していません**。

導入すると `server/thirdparty/logoframe_py/LICENSE` に MIT の全文が入ります。

### joinlogoscp_py — ライセンス表記なし（作者の許諾表明のみ。**本リポジトリには含まれません**）

```
join_logo_scp v5.1.1
Copyright (c) yobibi
https://github.com/yobibi/join_logo_scp
```

原典に正式なライセンス表記はなく、作者による次の表明のみです。

> CM自動カット位置情報作成。転載・改変は連絡不要です（各自の責任でお願いします）。

OSS ライセンスではないため、出所を明示したうえで各自の責任で扱ってください。
導入すると `server/thirdparty/joinlogoscp_py/NOTICE` に同じ内容が入ります。

### `server/media/tsukujima/` — MIT

```
KonomiTV
Copyright (c) 2021-2026 tsukumi
https://github.com/tsukumijima/KonomiTV
```

各ファイル冒頭に帰属表示があります。`jikkyo_channels.json` も同出所です。

### `server/media/tsukujima/lbpcascade_animeface.xml` — MIT

```
Copyright (C) 2011 by nagadomi@nurs.or.jp
https://github.com/nagadomi/lbpcascade_animeface
```

ライセンス全文がこの XML ファイル自身の冒頭コメントに含まれているため、ファイルを
そのまま同梱することで帰属表示の要件を満たしています。

---

## 3. 実行時に取得する外部ツール（`server/thirdparty/`）

`server/thirdparty/install.sh` が取得するもので、本リポジトリには含まれません。同梱して
再配布する場合は、それぞれの条件に従ってください。

| ツール | 出所 | ライセンス |
|---|---|---|
| read_tsprogram | https://github.com/noshiket/read_tsprogram （TS の読み取り。中に aribb24.js の移植を含む） | MIT |
| tsreadex | https://github.com/xtne6f/tsreadex | MIT |
| psisiarc | https://github.com/xtne6f/psisiarc | MIT |
| psisimux | https://github.com/xtne6f/psisimux | MIT |
| Akebi | https://github.com/tsukumijima/Akebi | MIT（https://github.com/ncruces/keyless 由来） |
| QSVEncC | https://github.com/rigaya/QSVEnc | MIT |
| biim | https://github.com/monyone/biim | MIT |
| FFmpeg | https://github.com/BtbN/FFmpeg-Builds （**gpl** ビルド） | **GPL** |
| logoframe_py | Amatsukaze のロゴ判定の Python 移植（別リポジトリ） | MIT |
| chapterexe_py | rigaya/chapter_exe の Python 移植（別リポジトリ） | **GPL-2.0** |
| joinlogoscp_py | yobibi/join_logo_scp の Python 移植（別リポジトリ） | 原典の作者の許諾表明に従う |

---

## 4. Python 依存パッケージ

`server/requirements.txt` に記載。インストール済みパッケージのメタデータから確認したものです。

| ライセンス | パッケージ |
|---|---|
| MIT | quart, beautifulsoup4, ariblib, pydantic, pyyaml, ruamel.yaml, grapheme, PyJWT, biim |
| BSD 系 | uvicorn (BSD-3-Clause), av / PyAV (BSD-3-Clause), numpy, numba |
| Apache-2.0 | requests, aiofiles, bcrypt, aiohttp, opencv-python-headless |

`av` と `opencv-python-headless` のホイールには FFmpeg が同梱されています（通常は LGPL
ビルド）。再配布する場合はそちらの条件も確認してください。

---

## 5. 外部で動かすソフトウェア

同梱も再配布もしません。HTTP API か別プロセスとして呼ぶだけです。

| ソフト | ライセンス |
|---|---|
| [Amatsukaze](https://github.com/nekopanda/Amatsukaze) | 全体は GPL（同梱ライブラリによる）。作者自身のコードは MIT |
| [EDCB](https://github.com/xtne6f/EDCB) | 明示的なライセンス表記なし。Civetweb 部分のみ別途 `LICENSE-Civetweb.md` |
| join_logo_scp / chapter_exe / logoframe / 透過性ロゴフィルタ (delogo) | Amatsukaze 側に同梱される。delogo は [makiuchi-d](https://github.com/makiuchi-d/delogo-aviutl)（フリーソフトウェアとして配布、無保証）および [rigaya/delogo](https://github.com/rigaya/delogo) |

---

## 6. 外部サービス

しょぼいカレンダー / Wikipedia / ニコニコ実況・NX-Jikkyo からデータを取得します。
各サービスの利用規約に従ってください。取得したデータの再配布は想定していません。
