"""API の通り方の決まり（連携先に許すパス・読むだけで良いパス・管理者だけのパス）"""

import re


# federationピア(他ノード)からの中継リクエストに開放するAPI（method集合, パス正規表現）。
# 番組表・予約・自動予約・録画/エンコード一覧・サムネの閲覧/操作のみ。
# config変更・再起動・ユーザー管理等の管理系は絶対に含めない。
_FED_ALLOWED = [
    # アドオンの予約は reserve_id が負（programs.id の符号反転）
    ({'GET'}, re.compile(r'^/api/reserves/augmented(/-?\d+)?$')),
    ({'POST'}, re.compile(r'^/api/reserves$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/reserves/\d+$')),
    ({'GET'}, re.compile(r'^/api/recordings/augmented(/\d+)?$')),
    ({'GET'}, re.compile(r'^/api/encode/recordings$')),
    ({'GET'}, re.compile(r'^/api/encode/addon_jobs$')),
    # エンコードの停止/再開（マスターからスレーブのエンコードを止められるように）
    ({'GET', 'POST'}, re.compile(r'^/api/encode/pause$')),
    ({'GET'}, re.compile(r'^/api/encode/recordings/\d+/thumbnail$')),
    # CMカット解析の結果（分割画面のシークバーに出すだけの読み取り）
    ({'GET'}, re.compile(r'^/api/encode/recordings/\d+/cm_analysis$')),
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/cm_analysis$')),
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/chapters$')),
    ({'GET'}, re.compile(r'^/api/encode/encodings/\d+/thumbnail$')),
    ({'GET', 'POST'}, re.compile(r'^/api/auto_add$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/auto_add/\d+$')),
    ({'GET', 'POST'}, re.compile(r'^/api/manu_add$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/manu_add/\d+$')),
    ({'GET'}, re.compile(r'^/api/(services|epg|search|logo|rec_setting_options|content_types|tuners|tuner_reserves)$')),
    # 局ロゴの有無一覧。表示中サーバーのロゴを出すため(無ければ局名テキストにフォールバック)
    ({'GET'}, re.compile(r'^/api/logo/list$')),
    ({'POST'}, re.compile(r'^/api/patterns/sync$')),
    ({'GET'}, re.compile(r'^/api/patterns/sids$')),
    ({'GET'}, re.compile(r'^/api/patterns$')),
    # 解析プレビュー（保存しない計算だけ）。予約・録画の詳細のプレビューを、その予約・録画のサーバーの
    # パターンで出すため（このサーバーで出すと、サーバーごとにパターンが違う時に実際の解析と食い違う）
    ({'POST'}, re.compile(r'^/api/patterns/(preview|normalize)$')),
    # ── 予約詳細(操作)。マスターからスレーブの予約詳細を開けるようにするため ──
    ({'PATCH'}, re.compile(r'^/api/rules/\d+$')),
    ({'POST'}, re.compile(r'^/api/rules/\d+/reparse$')),
    ({'GET'}, re.compile(r'^/api/rules/\d+/auto_add_candidates$')),
    # ── 録画詳細(操作)。マスターからスレーブの録画詳細を完全操作できるようにするため ──
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/(reparse|queue|requeue|scan_eit|scan_eit_head|extract_logo)$')),
    ({'GET'}, re.compile(r'^/api/encode/recordings/\d+/(probe|columns|frame|frames|thumbnail-tile)$')),
    ({'PATCH'}, re.compile(r'^/api/encode/recordings/\d+/(confirmed|encode_info|segments)$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/recordings/\d+$')),
    ({'POST'}, re.compile(r'^/api/recordings/manual$')),
    ({'DELETE'}, re.compile(r'^/api/recordings/manual/\d+$')),
    ({'GET'}, re.compile(r'^/api/encode/options$')),
    ({'GET'}, re.compile(r'^/api/amatsukaze/profiles$')),
    ({'POST'}, re.compile(r'^/api/patterns/resolve_path$')),
    ({'GET', 'POST'}, re.compile(r'^/api/auto_encode$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/auto_encode/\d+$')),
    # ── エンコード進捗 ──
    ({'GET'}, re.compile(r'^/api/encode/encodings/\d+/console$')),
    ({'POST'}, re.compile(r'^/api/encode/encodings/\d+/retry$')),
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/skip_encode$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/encode/encodings/\d+$')),
    # ── 分割画面プレビュー ──
    ({'GET'}, re.compile(r'^/api/encode/recordings/\d+/hls/(manifest\.m3u8|seg\.ts)$')),
    ({'GET'}, re.compile(r'^/api/encode/recordings/\d+/video_stream$')),
    # ── 録画再生(オンデマンドHLS) ──
    ({'GET'}, re.compile(r'^/api/streams/video/\d+/(metadata|captions-data|comments|drops)$')),
    ({'GET'}, re.compile(r'^/api/streams/video/\d+/[^/]+/(playlist|segment)$')),
    ({'PUT'}, re.compile(r'^/api/streams/video/\d+/[^/]+/keep-alive$')),
    # ── ライブ視聴(マスターからスレーブのチューナー視聴) ──
    ({'GET'}, re.compile(r'^/api/streams/channels$')),
    ({'GET'}, re.compile(r'^/api/streams/live/[^/]+/[^/]+/(mpegts|events)$')),
    ({'GET'}, re.compile(r'^/api/streams/live/[^/]+/[^/]+/hls/(playlist\.m3u8|segment\.ts|overlays)$')),
    ({'DELETE'}, re.compile(r'^/api/streams/live/[^/]+/[^/]+/hls$')),
    ({'GET'}, re.compile(r'^/api/streams/live/[^/]+/jikkyo$')),
    ({'GET'}, re.compile(r'^/api/jikkyo/forces$')),
    # ── 録画詳細の重複video表示(サムネのみ。再生系は未開放) ──
    ({'GET'}, re.compile(r'^/api/videos/\d+/thumbnail$')),
    # ── ライブラリ動画のテロップ告知(取得/手動設定) ──
    ({'POST'}, re.compile(r'^/api/videos/\d+/fetch_announce$')),
    ({'PATCH'}, re.compile(r'^/api/videos/\d+/announce$')),
    # ── ライブラリ閲覧(他ノードのライブラリをそのまま見る。更新系は開放しない) ──
    ({'GET'}, re.compile(r'^/api/library$')),
    ({'GET'}, re.compile(r'^/api/videos/(albums|list|cards|momentum)$')),
    ({'GET'}, re.compile(r'^/api/music/(overview|artists|albums|tracks)$')),
    # ローカル保存キャッシュの追従: 移動先サーバーを放送の識別子で探すため
    ({'GET'}, re.compile(r'^/api/videos/find_by_broadcast$')),
    ({'GET'}, re.compile(r'^/api/videos/albums/\d+(/captures|/thumbnail)?$')),
    ({'GET'}, re.compile(r'^/api/videos/series/\d+(/videos|/thumbnail)$')),
    ({'GET'}, re.compile(r'^/api/videos/categories/\d+$')),
    ({'GET'}, re.compile(r'^/api/videos/\d+/(meta|confirmed|added-tracks|tag)$')),
    ({'PUT'}, re.compile(r'^/api/videos/\d+/tag$')),
    ({'GET'}, re.compile(r'^/api/streams/captures/[^/]+$')),
    # ── マスターへ移動(スレーブのライブラリをマスターUIから操作するため) ──
    ({'PATCH'}, re.compile(r'^/api/videos/\d+/confirmed$')),
    ({'POST'}, re.compile(r'^/api/videos/\d+/relocate$')),
    # ── ライブラリ動画の再生(オンデマンドHLS。/api/streams/video/* と同じ範囲) ──
    ({'GET'}, re.compile(r'^/api/streams/vdb/\d+/(metadata|captions-data|comments|drops|thumbnail-tile)$')),
    ({'GET'}, re.compile(r'^/api/streams/vdb/\d+/[^/]+/(playlist|segment|buffer)$')),
    ({'PUT'}, re.compile(r'^/api/streams/vdb/\d+/[^/]+/keep-alive$')),
    # ── 設定画面(サーバー由来の設定。端末ローカルの設定は切り替え対象外) ──
    ({'GET', 'PATCH'}, re.compile(r'^/api/config$')),
    ({'POST'}, re.compile(r'^/api/config/(test_connection|generate_secret|disk_status|restart)$')),
    ({'GET'}, re.compile(r'^/api/config/restart/busy$')),
    ({'GET'}, re.compile(r'^/api/(storage|logs)$')),
    ({'GET'}, re.compile(r'^/api/logo/(list|fetch_edcb)$')),
    ({'POST'}, re.compile(r'^/api/logo/cache/clear$')),
    ({'POST'}, re.compile(r'^/api/edcb/(reload_epg|epg_cap)$')),
    ({'POST'}, re.compile(r'^/api/patterns/sync_all$')),
    ({'GET', 'POST'}, re.compile(r'^/api/amatsukaze/profiles$')),
    ({'PATCH', 'DELETE'}, re.compile(r'^/api/amatsukaze/profiles/[^/]+$')),
    ({'GET'}, re.compile(r'^/api/amatsukaze/(system|info/disks)$')),
    ({'POST'}, re.compile(r'^/api/amatsukaze/queue/pause$')),
    # 設定(AMZ)画面のキュー表示と、中止/削除。ノードを切り替えて相手側を見るため
    ({'GET'}, re.compile(r'^/api/amatsukaze/queue$')),
    ({'POST'}, re.compile(r'^/api/amatsukaze/queue/change$')),
    ({'GET'}, re.compile(r'^/api/addons/settings$')),
    ({'PATCH'}, re.compile(r'^/api/addons/[^/]+/settings$')),
    ({'POST'}, re.compile(r'^/api/addons/[^/]+/fire$')),
    # 録画を別サーバーへ転送する（エンコードなし）。録画詳細は viewNode の
    # サーバーを見ているので、中継しないと相手側の録画に対して押せない
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/transfer$')),
    # 追加依存(requirements.txt)の導入。設定画面は viewNode のサーバーを見ているので、
    # 中継しないと「別のサーバーの設定を見ながら押したのに自サーバーへ入る」ことになる
    ({'POST'}, re.compile(r'^/api/addons/[^/]+/install$')),
    # 番組表ソースアドオン(target='guide')の番組データ。番組表画面は viewNode の
    # サーバーを見ているので、中継しないと相手側で有効にしても表が出ない
    ({'GET'}, re.compile(r'^/api/addons/[^/]+/guide$')),
    # ── アドオン(他ノードの録画/動画に対して実行する) ──
    # ロゴ生成のようにアドオンが片方のサーバーにしか入っていない構成があるため、
    # 一覧・実行・ジョブ状態を中継する。実行対象のあるノードへ一式を向ける
    ({'GET'}, re.compile(r'^/api/addons$')),
    ({'GET'}, re.compile(r'^/api/addons/jobs$')),
    ({'GET'}, re.compile(r'^/api/addons/jobs/[^/]+$')),
    ({'POST'}, re.compile(r'^/api/videos/\d+/addons/[^/]+/run$')),
    ({'POST'}, re.compile(r'^/api/encode/recordings/\d+/addons/[^/]+/run$')),
    # アドオンが渡すファイル(切り抜きの MP4 などのダウンロード)
    ({'GET'}, re.compile(r'^/api/addons/[^/]+/files/[^/]+$')),
    # ロゴ生成(Amatsukaze)の進捗・プレビュー画像・適用/破棄
    ({'GET'}, re.compile(r'^/api/amatsukaze/logo/analyze/[^/]+(/image)?$')),
    ({'POST'}, re.compile(r'^/api/amatsukaze/logo/analyze/[^/]+/(apply|discard)$')),
    # ── ローカル保存(他ノードの動画をブラウザへ保存する) ──
    ({'GET'}, re.compile(r'^/api/videos/\d+/(download|media)$')),
    ({'DELETE'}, re.compile(r'^/api/videos/\d+/download/secondary$')),
]


# 閲覧のみ(can_write=0)の利用者にも通す非GET。再生の生存確認と、自分用のマイリストだけ。
_READONLY_OK = [
    ({'PUT'}, re.compile(r'^/api/streams/(video|vdb|live)/.+/keep-alive$')),
    ({'PUT', 'DELETE'}, re.compile(r'^/api/users/me/mylist/\d+$')),
]


# サーバー全体の設定。管理者だけが触れる（利用者の設定画面はアカウントのみ）。
# 接続先やWebhook URLが読めてしまうので GET も塞ぐ。
# ロゴは /logo と /logo/list が表示に要るので、更新系(cache/clear, fetch_edcb)だけ管理者に限る。
# アドオンは一覧/実行は利用者にも要る（プレイヤーのタブ等）ので、設定と導入だけ管理者に限る。
_ADMIN_ONLY = re.compile(
    r'^/api/(config($|/)'
    r'|addons/(settings$|[^/]+/(settings|install)$)'
    # Amatsukaze の設定・キュー・止める操作など。ロゴの解析だけは再生画面（ロゴのタブ）からも使う
    r'|amatsukaze/(?!logo/analyze)'
    r'|logo/(cache/clear|fetch_edcb)$'
    # サーバーのログ・ディスク・番組表の取り直し・パターンの一括同期・音声解析の順番待ち（設定の画面だけが使う）
    r'|logs$|storage$|edcb/(reload_epg|epg_cap)$|patterns/sync_all$|audio-compare/queue($|/))')
