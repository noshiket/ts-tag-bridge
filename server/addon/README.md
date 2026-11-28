# アドオンの書き方

`server/addon/` にファイルを置くと、サーバーに機能を足せます。

- **再起動は要りません。** 一覧を出す時・呼ぶ時に、毎回読み直します。
- **書き間違えても他は壊れません。** 読み込めなかったアドオンは、設定 → アドオン に理由つきで出ます。
- **本体はアドオンの名前を知りません。** アドオンは `ADDON` に「何をするか」を書いて名乗り、本体と画面はそれを見て動きます。
  アドオンを足しても、アプリを作り直す必要はありません。

---

## いちばん小さいアドオン

```python
# server/addon/hello.py
ADDON = {
    'target': 'video',          # 何に使うか（下の「種類」）。省くと 'video'
    'label': 'あいさつ',          # 画面に出る名前（必須）
    'description': '動画の題名をログに出すだけ',
}

def run(ctx, params):
    ctx.log(f"題名: {ctx.tag.get('title')}")
    return '終わりました'         # 文字か dict を返すと画面に出る
```

これでライブラリの動画の「…」から「あいさつ」を実行できます。

置き方は2通りあり、アドオンの名前はファイル名（またはフォルダ名）になります。

```
server/addon/hello.py           # 1ファイル
server/addon/hello/main.py      # フォルダ（補助のモジュール・同梱のデータ・requirements.txt を置ける）
```

---

## ADDON に書けること

どの種類でも使える項目:

| 項目 | 内容 |
|---|---|
| `target` | 種類（下の表）。省くと `'video'` |
| `label` | 画面に出る名前。**必須** |
| `description` | 説明 |
| `params` | 実行する時に入れてもらう項目。画面はこれから入力欄を作る |
| `settings_params` | 一度決めたら変えない項目（URL・NG ワードなど）。これを持つアドオンは、種類に関わらず 設定 → アドオン に出る |
| `queue` | 順番待ちの名前。同じ名前のアドオンは1本ずつ順に流す（CPU や GPU を長く使うもの向け） |
| `encode_queue` | `True` で、録画のエンコードと同じ順番待ちに載せる（QSV を取り合わないように。`video` 向け） |
| `output_ttl_sec` | 利用者へ渡すファイルを作るアドオン。その寿命（秒）。下の「ファイルを渡す」 |

`params` / `settings_params` の1項目:

```python
{'key': 'url', 'label': 'URL', 'type': 'string', 'required': True, 'default': ''}
```

`type` は `string` / `number` / `bool` / `select`（`'options': [...]` を添える）。
`key` が無い項目があると読み込みに失敗します。

種類ごとの項目（`events`・`steps`・`player_ui`・`marks` など）は、それぞれの節に書いてあります。

---

## 種類（target）

| target | いつ動くか | 設定の置き場 | 見本 |
|---|---|---|---|
| `video` | ライブラリの動画の「…」から手で実行 | 実行する時の入力 | `sample_tag_info`・`transcode_h264` |
| `encoder` | エンコードの段取りが、エンコードの方法として呼ぶ | `config.yml` | `ffmpeg_encode`・`qsvenc_hevc` |
| `event` | 録画・エンコードの節目に自動で | 設定 → アドオン | `notify_webhook`・`streamlink_record` |
| `settings_tab` | 設定 → アドオン に項目を出し、手で試す | 設定 → アドオン | — |
| `guide` | 番組表にタブを足す | 設定 → アドオン | `sample_guide`・`abema_guide` |
| `parser_action` | パターン（番組名の読み解き）に動きを足す | パターンの側 | `parser_concat`・`parser_contains`・`tver_subtitle` |
| `player_tab` | 再生画面にタブを足す | 実行する時の入力 | `chapter_edit`・`clip_export`・`amz_logo` |
| `cm_analysis` | CM 解析の結果を直す・書き足す | 設定 → アドオン | `smartcut_cm`・`cm_gap_marks` |
| `language` | アプリの表示言語を足す（設定 → アカウント → 表示言語 に出る） | 設定 → アドオン | `lang_en` |

`event`・`settings_tab`・`guide` は、入れた直後は**無効**です（よそへ何かを送る・取りに行くものが黙って動かないように）。
設定 → アドオン で有効にします。それ以外は最初から有効で、同じ画面で無効にできます。

---

### video — 動画に対して手で実行する

`ctx` が持つもの:

| 名前 | 内容 |
|---|---|
| `video_id` / `video` | 動画の id と、`videos` の行（dict） |
| `tag` / `tag_path` | 動画の情報（tag.json）の中身とその場所 |
| `video_db` / `rule_db` / `config` | データベースと設定 |
| `log(msg)` | 実行のログに書く（画面に出る） |
| `save_tag(tag=None)` | tag.json に書く（省くと `ctx.tag`） |
| `apply_tag_to_db()` | tag.json をデータベースへ取り込み直す。新しい `video_id` を返す |

動画の情報は **tag.json が元で、データベースはその写し**です。値を変えたら `save_tag()` → `apply_tag_to_db()` の順に呼びます。
データベースだけを書くと、エンコードし直した時や置き場所を移した時に消えます。

- 実行は裏で動き、画面は進み具合を聞きに来ます。同じ動画に2本同時には走りません。
- `queue` を付けると、その名前ごとに1本ずつ流れます。順番を待っている間は、ログに「順番待ち N番目」と出ます。
- `encode_queue: True` を付けると、その場では走らず、録画のエンコードと同じ順番待ちに1行載ります。
  順番・一時停止・進み具合は、エンコードの画面で見られます。

### encoder — エンコードの方法になる

CM の位置で分けた TS（`ctx.input_ts`）を `ctx.output_dir` へエンコードして、次を返します。

```python
{'output_path': str, 'trim_segments': [...], 'chapter_txt': str | None}
```

`trim_segments` は**必須**です。CM を切らない時は `ctx.full_trim_segments()` を返します。
その後の時刻合わせ・サムネ・tag.json・ライブラリへの登録・ほかのサーバーへの送り出しは、本体が行います。

`ctx` の主なもの: `enc` / `recording` / `input_ts` / `output_dir` / `output_stem` / `source_ts` /
`recording_start_time` / `recording_end_time` / `duration_sec` / `log(msg)` / `step(名前, 進み具合)` / `should_abort()`。

- `steps` に、進み具合の画面に出す段の名前を並べられます（省くと `['encode']`）。
- 長くかかる処理では `should_abort()` を見て、止められたら抜けてください。

### event — 節目で自動で動く

`events` に聞きたい出来事を並べます。`'encoding.*'` のように末尾を `*` にすると、まとめて聞けます。`'*'` だけなら全部です。

```python
ADDON = {'target': 'event', 'label': '失敗を知らせる', 'events': ['recording.failed', 'encoding.failed'],
         'settings_params': [{'key': 'url', 'label': '送り先', 'type': 'string'}]}

def run(ctx, params):
    ...  # ctx.event / ctx.payload を見て、params['url'] へ送る
```

`ctx` が持つもの: `event` / `payload` / `config` / `rule_db` / `video_db` / `log(msg)`。

| 出来事 | payload |
|---|---|
| `program.added` | `program_id, reserve_id, title, station_name, start_time` |
| `program.updated` | `program_id, changed`（変わった列の名前） |
| `recording.added` | `recording_id, program_id, title, station_name, start_time, ts_path` |
| `recording.updated` | `recording_id, changed` |
| `recording.failed` | `recording_id, state, title, station_name, start_time, error` |
| `encoding.queued` | `encoding_id, recording_id, state` |
| `encoding.state` | `encoding_id, state, prev_state, encoding`（行）。状態が変わる度に必ず |
| `encoding.started` | 同じ（エンコードに入った時） |
| `encoding.finished` | 同じ（終わった時） |
| `encoding.failed` | 同じ（失敗した時。理由は `encoding.error_message`） |
| `video.added` | `video_id, replaced, file_path, title, station_name` |
| `tick.minute` | `now`。1分ごと（下の「時刻で動かす」） |
| `recording.scan` | `recording, ts_path, addon, sid`。`provides_scan` を名乗ったアドオンにだけ来る（下の「録画の番組情報を自分で出す」） |
| `recording.scan_skipped` | `recording_id, program_id, addon, sid, ts_path, reason`。番組情報の無い TS で、本体が読み取りを飛ばした |

- 出来事は、状態が**実際に変わった時だけ**流れます。進み具合のような細かい更新では流れません。
- アドオンは専用のスレッドで呼ばれます。例外はログに残るだけで、録画やエンコードは止まりません。
- それでも節目の流れから呼ばれるので、重い処理や長い待ちは避けてください（通知の見本はネットワークを10秒で打ち切ります）。
- データベースへ書く時は、トランザクションの区切りを自分で意識してください。
- 送るかどうかを設定で切り替えたい時は、`events` に候補を全部並べ、出来事ごとの `bool` の項目を `run()` の先頭で見て抜けます（`notify_webhook` はそうしています）。

#### 時刻で動かす（`tick.minute`）

アドオンは呼ぶ度に読み直すので、常駐できません。「時刻が来たら動く」ものは、1分ごとに流れる `tick.minute` を起点にします。
毎分呼ばれるので、重い処理は自分で間引いてください。

予約や録画は、本体の表へ直接書けます。

| 書く先 | 出る場所 |
|---|---|
| `rule_db.add_rule(reserve_id=None, ...)` | 予約の一覧（EDCB に無い予約として出る。EDCB との同期で書き換わらない） |
| `rule_db.add_recording(host_ts_path=..., program_id=..., addon='<自分の名前>')` | 録画結果 |

#### 番組表から予約を受ける（`records_guide`）

`records_guide: True` を名乗ると、`guide` のアドオンが出す番組に**予約のボタン**が出ます。
押されると `POST /api/addons/<名前>/fire` で `event='reserve'` が届きます。

- 予約の前に出す入力欄は、このアドオンの `params` から作ります。`params` が無ければ、入力欄を出さずに予約します。
- 空欄の項目は送られません（アドオンの設定の既定値を使ってください）。
- `event='defaults'` に `{'ok': True, 'defaults': {key: 値}}` で答えると、空欄に既定値が薄く出ます。

#### 録画の番組情報を自分で出す（`provides_scan`）

本体は、録画の題名・説明・時刻を TS の番組情報（EIT）から読みます。
配信を取り込んだ TS のように、そこに情報が無い録画のために、アドオンが代わりに答えられます。

```python
ADDON = {'target': 'event', 'label': '...', 'provides_scan': True}   # events に書かなくても来る

def run(ctx, params):
    if ctx.event != 'recording.scan' or ctx.payload.get('addon') != '<自分の名前>':
        return None                       # 自分が録った物でなければ降りる
    return {'title': ..., 'description': ..., 'service_name': ..., 'start_time': ..., 'end_time': ...}
```

- 最初に dict を返したアドオンの答えが使われます。誰も答えなければ、本体がいつもどおり EIT を読みます。
- **扱えない録画には必ず `None` を返してください。**
- 誰が録ったかは `payload['addon']` で分かります。録画を登録する時に `addon='<自分の名前>'` を入れておきます。

番組情報が無い TS では、本体は読み取りを飛ばして `recording.scan_skipped` を流します。代わりに何をするかは、その録画を作ったアドオンが決めます。
ここでも `payload['addon']` が自分の名前の時だけ動き、ほかのアドオンの録画には手を出さないでください。

#### 配信の録画と SID

パターンは放送局の番号（SID）ごとに持ち、チャプターの解析も SID で局の設定を引きます。配信には SID がありません。
そのため、配信を録るアドオンは、放送と重ならない番号を1つ決めて名乗ります（`streamlink_record` は 9000）。

- 予約（`programs.sid`）と録画（`recordings.sid`）の両方に入れます。予約に無いと、予約の画面からパターンを作れません。
- **TS の中の番号もそろえてください。** 再生の時は SID で流れを選ぶので、TS が名乗る番号と違うと何も映りません。
  `streamlink_record` は、録り終えた後に TS の番号を書き換えています。
- チャプターの解析は、ロゴの無い局として登録済みの局の設定を借ります。借りる先が無いと解析できません。

### settings_tab — 設定の画面に項目を出す

設定 → アドオン に `settings_params` の項目と「テスト実行」のボタンを出します。出来事は聞きません。
ボタンを押すと `run()` が呼ばれます。`ctx` は `event` と同じで、`ctx.event` は `'test'` になります。

### guide — 番組表にタブを足す

番組表の 地デジ / BS / CS の後ろにタブが増えます。選ぶと、アドオンが返した局と番組がいつもの表に並びます。

```python
ADDON = {'target': 'guide', 'label': 'ニュースの配信'}

def run(ctx, params):                     # params['date'] に表示している日（YYYY-MM-DD）
    return {
        'channels': [{'id': 'news', 'name': 'ニュースch', 'short': 'ニュース',
                      'logo_url': 'https://example.com/logo.png'}],          # short・logo_url は任意
        'programs': [{'ch': 'news', 'start_time': '2026-09-02 12:00:00', 'duration_sec': 1800,
                      'title': '昼のニュース', 'description': '...', 'genre': 'news',
                      'url': 'https://example.com/episode'}],                 # description・genre・url は任意
    }
```

- その日の分を返せば足ります。番組表は朝4時から翌朝4時なので、本体が日をずらして何回か呼んでつなぎます。
- `genre` は色分けに使います。`news` / `sport` / `var` / `drama` / `music` / `movie` / `anime` / `doc` / `edu`（ほかは `var`）。
- `start_time` はタイムゾーンつきでも構いません。サーバーの時刻に直します。
- 形の合わない行は捨てるだけで、表は壊れません。返り値が dict でなければ失敗になります。
- 結果はサーバーが10分覚えています。アドオンの側で覚えておく必要はありません。
- `url` のある番組は「<label> で開く」ボタンが出ます（`http://` か `https://` だけ）。
- 局に `live_url` を付け、`records_guide` を名乗るアドオンがあると、予約のボタンが出ます。
- EDCB の番組ではないので、EDCB の予約・ライブ視聴・実況の勢いは出ません。
- 設定は `settings_params` に書きます（番組表には実行の入力欄がありません）。

`ctx` が持つもの: `config` / `rule_db` / `video_db` / `log(msg)`。

### parser_action — パターンに動きを足す

パターン（番組名から作品名・話数などを決める決まり）の「アクション」を増やします。
パターンの編集画面の選択肢に並び、`params` がそのまま入力欄になります。

```python
ADDON = {
    'target': 'parser_action',
    'key': 'concatStr',            # パターンの JSON での名前。組み込みと同じ名前は使えない
    'label': '文字列結合',
    'output_type': 'string',       # 画面の表示用
    'default_field': 'title',      # 書き込む先の既定
    'deferred': True,              # ほかの出力を使うなら True
    'params': [
        # 先頭を key='field' にすると「出力フィールド名」の欄になる（組み込みと同じ決まり）
        {'key': 'field', 'label': '出力フィールド名', 'type': 'field_ref', 'required': True},
        {'key': 'parts', 'label': 'パーツ', 'type': 'template_string', 'required': True},
    ],
}

def run(ctx, config):
    return ctx.resolve(config.get('parts'))   # 返した値が出力に入る。None なら何も入れない
```

`ctx` が持つもの:

| 名前 | 内容 |
|---|---|
| `groups` | パターンで取れた部分 `{'1': '...', '2': '...'}` |
| `context` | 読み解きの材料（`title` / `service_name` / `sid` / `start_time` など） |
| `fields` | 決まった出力（`deferred=True` の時だけ） |
| `resolve(s)` | `{$1}` / `{$出力}` / `$材料` をまとめて埋める |
| `log(msg)` | サーバーのログに書く |

- `deferred: False` は `{$N}` と `$材料` だけを使い、組み込みの `setStr` と同じ時に動きます。
- `deferred: True` はほかの出力（`{$title}` など）も使い、全部のアクションが済んだ後に動きます。
- `run()` が例外を出しても読み解きは止まらず、そのアクションだけが飛ばされます（ログに残ります）。

#### 分かれ道の型（`branching: True`）

組み込みの `switch` と同じく、条件で子のアクションを選びます。見本は `parser_contains`。

```python
def run(ctx, config):
    return {'analyze': [{'setStr': 'category', 'str': '映画'}]}   # 実行したい子アクション。None なら何もしない
```

子には組み込みもほかのアドオンのアクションも書けます。`params` に入れ子のアクションの配列を持つものは、
アクションの入力欄では直せないので、`switch` と同じくパターン全体の JSON で書きます。

#### 文字を取ってくる型（`fetch_text: True`）

外から文字を取ってきて、それに `pattern` / `analyze` をかけます。見本は `tver_subtitle`（外のサイトから副題を取る）。

```python
def run(ctx, config):
    # config は読み替え済み: {'sid': 数か None, 'start_time': 放送日時, 'text': 照らし合わせる題名}
    return '取ってきた文字'       # 見つからなければ None（読み解きの失敗になる）
```

- パターンの側には `sid` / `startTimeField` / `textField` / `pattern` / `analyze` を書きます。`pattern` を省くと、取った文字をそのまま `episode_name` に入れます。
- ほかのアクションが全部済んだ後に動きます。
- アドオンを無効にしても選択肢には残り、保存したパターンは壊れません（読み解きでは「見つからない」と同じ扱い）。
- 例外も「見つからない」と同じ扱いです。
- 呼ぶ度に読み直されるので、覚えておきたい物（ログインの答えなど）は、別のファイルを一度だけ読み込んで持たせます。

#### 候補を探す（`search`）

`search(text, sid)` を持つと、パターンの編集画面で、取ってこられる候補を前もって見られます
（`GET /api/addons/<名前>/search?text=&sid=`）。

### player_tab — 再生画面にタブを足す

再生画面にタブを1つ増やします。見出しは `tab_label`（無ければ `label`）。
対象は `source` で選び、省くとライブラリの動画、`'recording'` で録画の TS です。

```python
ADDON = {'target': 'player_tab', 'label': '切り抜き保存', 'player_ui': 'clip_range', 'params': [...]}
```

タブの中身は `player_ui` で選びます。

| player_ui | 中身 |
|---|---|
| `chapters` | チャプターを足す・消す・直す（`params['chapters']` に JSON で届く） |
| `clip_range` | 再生位置で始まりと終わりを決める（`params['start']` / `params['end']`） |
| `logo_rect` | 映像の上でロゴを囲む（`params['rect']`。`source: 'recording'` 用） |
| 省く・それ以外 | `params` から入力欄を作り、「実行」で今の動画・録画に対して `run()` を呼ぶ |

アドオンが画面の部品（JS）を持つことはできません（iOS ではアドオンの JS を動かせないため）。
出したいものは、`player_ui` や `params` のような宣言で名乗ってください。

### cm_analysis — CM 解析の結果を直す

CM 解析（ロゴ・無音・シーンの切り替わり）の結果を受け取り、直した dict を返します。返さなければそのまま通ります。
解析の後に自動で呼ばれ、分割の画面からかけ直すこともできます。

```python
def run(ctx, params):
    result = ctx.payload['result']          # ほかに recording / ts_path / recording_id / addon
    result['my_marks'] = [{'start': 120.0, 'end': 210.5}]
    return result
```

書き足した物を分割の画面に出す時は、`marks` で出し方を名乗ります。

```python
'marks': [{'key': 'my_marks', 'kind': 'range', 'label': '見つけた CM', 'short': 'CM',
           'color': 'oklch(0.68 0.16 170)', 'jump': True}]
```

| 項目 | 意味 |
|---|---|
| `key` | 結果に足した鍵（値は配列） |
| `kind` | `range`（`start`〜`end`）か `point`（`sec` か `start`。コマは `frame` / `start_frame`） |
| `label` | 凡例の名前（件数を添えて出す） |
| `short` | ▼の説明に出す短い名前（無ければ `label`） |
| `color` | 色（CSS の色。無ければ灰色） |
| `jump` | ▼の飛び先に足すか（`range` は両端） |
| `near_sec` | この秒数より近くに▼があれば足さない（既定 0.3） |
| `annotate` | 足さなかった時、その▼に小さな印を添えるか（既定 `True`） |

話ごとの区間も答えられます。本体は放送の枠を話数で割りますが、中身が枠より短い録画（CM を捨てて録った取り込みなど）では合いません。
`segments(recording, episode_count, duration_sec, params)` を持つと、その答えを使います（`None` なら本体の計算）。見本は `cm_gap_marks`。

---

## どの種類でも使えるもの

### 自分の API の口（`API`）

`ADDON`・`run` と並べて `API` を書くと、アドオンが自分の口を持てます。`/api/addons/<名前>/api/<サブパス>` で呼べます。

```python
def status(req):
    """今の状態を返す。（この説明書きが 設定 → アプリ → API の一覧 に出る）"""
    return {'ok': True, 'q': req.args.get('q')}

def reload(req):
    """読み直す。body: {force?}"""
    return {'reloaded': True, 'force': bool(req.body.get('force'))}, 202   # (値, 状態コード) も返せる

API = {
    'GET status': status,                            # ログインした人なら呼べる
    'POST reload': {'fn': reload, 'auth': 'admin'},  # 管理者だけ
}
```

- 鍵は `'<メソッド> <サブパス>'` です。サブパスは英数字・`_`・`-` を `/` でつないだ物です（`<id>` のような埋め込みはありません。値はクエリか本文で渡します）。
- 関数は `fn(req)` です。`req` が持つもの:
  - `addon` / `method` / `path`
  - `args`（クエリ）
  - `body`（JSON。無ければ `{}`）
  - `params`（設定 → アドオン で保存した値）
  - `user`（`id`・`username`・`is_admin`。サーバー同士の中継では `None`）
- 返した値は JSON で返ります。別のスレッドで呼ぶので重い処理も書けます（`async def` でも構いません）。
- 無効にしたアドオンは 503、表に無い口は 404、関数の例外は 502 を返します。
- 表の書き間違いは、呼んだ時に理由つきの 404 になり、API の一覧には出ません。
- ほかのサーバーから中継して呼ぶことはできません。
- 見本は `sample_tag_info` の `GET echo` です。

### ファイルを渡す（`output_ttl_sec`）

切り抜いた MP4 のように、利用者へ渡すファイルを作るアドオン向けです。
`<データの置き場>/addon/<名前>/` に作ると、`GET /api/addons/<名前>/files/<ファイル>` で渡せます。

- 渡し終えたファイルは消えます。
- 寿命（`output_ttl_sec` 秒）を過ぎたファイルは片付けで消えます。
- 見本は `clip_export` です。

### 足りないライブラリと前提の確かめ（`requirements.txt`・`check()`）

フォルダ形式のアドオンは、隣に `requirements.txt` を置けます。
設定 → アドオン が入っているかどうかを見て、足りなければ知らせと「インストール」ボタンを出します。
サーバーと同じ Python の pip で入れるので、venv の外には入りません。
ライブラリが無くて読み込めないアドオンでも、この案内は出ます。

pip で入れられない前提（日本語のフォント・外のコマンドなど）は `check()` で返します。

```python
def check():
    return {'ok': False, 'message': '字幕の焼き込みが使えません（日本語のフォントがありません）',
            'hint': 'sudo apt install fonts-noto-cjk'}
```

`ok` が `False` なら知らせとして、`True` なら `message` を控えめに出します。`check()` が例外を出しても一覧は壊れません。

### 設定の置き場

設定 → アドオン で保存した物は `<データの置き場>/addon/<名前>.json` に入ります。データの置き場は `config.yml` の `data_dir` で、空なら `server/data` です。

```json
{ "enabled": true, "params": { "url": "https://..." } }
```

データの置き場はリポジトリに入らないので、Webhook の URL のような秘密はここに置きます。**アドオンの本体には書かないでください。**

---

## サーバーの API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/addons?target=<種類>` | 有効なアドオンの一覧 |
| GET | `/api/addons/settings` | 設定のあるアドオンと、保存した値（管理者） |
| PATCH | `/api/addons/<名前>/settings` | 設定を保存 `{enabled, params}`（管理者） |
| POST | `/api/addons/<名前>/install` | `requirements.txt` を入れる（管理者） |
| POST | `/api/addons/<名前>/fire` | `event` / `settings_tab` を手で呼ぶ `{event?, payload?}` |
| GET | `/api/addons/<名前>/guide?date=<YYYY-MM-DD>` | `guide` の番組表 |
| GET | `/api/addons/<名前>/search?text=&sid=` | `search()` で候補を探す |
| GET | `/api/addons/<名前>/files/<ファイル>` | アドオンが作ったファイルを受け取る |
| GET/POST/PATCH/PUT/DELETE | `/api/addons/<名前>/api/<サブパス>` | アドオンが自分で持つ口 |
| POST | `/api/videos/<id>/addons/<名前>/run` | `video` を実行 → `{job_id}` |
| GET | `/api/addons/jobs/<job_id>` | 実行の進み具合と結果 |

全部の口と説明は、アプリの 設定 → アプリ → 開発者向け → API の一覧 でも読めます。

---

## 表示言語を足す（`language`）

アプリの文字は、日本語の辞書（`packages/core/src/i18n/ja/`）を元に「キー → 文」で引きます。
言語アドオンは、その言語の辞書を `run()` で返します。訳の無いキーはアプリが日本語で出すので、少しずつ足して構いません。

```python
# server/addon/lang_fr/main.py
ADDON = {'target': 'language', 'lang': 'fr', 'label': 'Français', 'description': 'フランス語で表示する'}

def run(ctx, params):
    return {'nav.epg': 'Guide', 'common.count': {'one': '{n} élément', 'other': '{n} éléments'}}
```

- `lang` は言語のコード（設定に保存される値）。`label` が選択肢に出る名前です。
- 文の中の `{n}` などは、アプリが数や名前で埋めます。単数と複数で変わる時は `{'one': ..., 'other': ...}` と書きます（`n` が 1 なら one）。
- `lang_en` は辞書を同じフォルダの `messages/`（画面の場所ごとの JSON）に置いています。キーの一覧の見本として使えます。キーと日本語の文は `packages/core/src/i18n/ja/` にあります（日本語と英語のキーがそろっているかは core のテストで確かめます）。

