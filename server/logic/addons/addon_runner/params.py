"""アドオンの項目（params）をそろえる・項目の表を作る"""


def _norm_params(raw):
    """params / settings_params を正規化する。"""
    out = []
    for p in (raw or []):
        if not isinstance(p, dict) or not p.get('key'):
            raise ValueError(f'不正なparams定義: {p!r}')
        out.append({
            'key': p['key'],
            'label': p.get('label') or p['key'],
            'type': p.get('type') or 'string',
            'required': bool(p.get('required')),
            'default': p.get('default'),
            'options': p.get('options') or None,
        })
    return out


def _schema_of(name, mod):
    """モジュールのADDON dictを検証済みスキーマへ正規化する。"""
    meta = getattr(mod, 'ADDON', None)
    if not isinstance(meta, dict):
        raise ValueError('ADDON dict がありません')
    if not callable(getattr(mod, 'run', None)):
        raise ValueError('run(ctx, params) がありません')
    if not meta.get('label'):
        raise ValueError("ADDON['label'] は必須です")
    params = _norm_params(meta.get('params'))
    steps = meta.get('steps')
    if not isinstance(steps, list) or not steps:
        steps = ['encode']
    return {
        'name': name,
        'target': meta.get('target') or 'video',
        'label': meta['label'],
        'description': meta.get('description') or '',
        'params': params,
        'steps': [str(s) for s in steps],  # 進捗UIに出すステップ名(encoder用。既定['encode'])
        # target='event' が購読するイベント名。'encoding.*' のような末尾ワイルドカード可
        'events': [str(e) for e in (meta.get('events') or [])],
        # 実行毎ではなく設定画面で持たせたい項目(NGワード等)。params と同じ形式。
        # これを持つアドオンは target に関わらず設定画面「アドオン」タブに出る。
        'settings_params': _norm_params(meta.get('settings_params')),
        # target='parser_action'(text_parser のアクション追加)用。
        # 他の target では使わないので、無ければそのまま None/False になる。
        'key': meta.get('key'),
        'output_type': meta.get('output_type'),
        'default_field': meta.get('default_field'),
        'deferred': bool(meta.get('deferred')),
        # branching=True: switch のように子アクション(analyze)を選んで実行するもの
        'branching': bool(meta.get('branching')),
        # fetch_text=True: 文字を取ってきて、その文字に text_parser が pattern / analyze をかける型
        'fetch_text': bool(meta.get('fetch_text')),
        # target='player_tab' の対象。'recording' は録画(TS)専用(ロゴ生成など)。
        # 省略時はライブラリ動画(MP4)が対象。
        'source': meta.get('source') or 'video',
        # プレイヤーのタブ見出し
        'tab_label': meta.get('tab_label') or meta.get('label'),
        # target='player_tab' のタブに出す編集部品（'chapters' / 'clip_range' / 'logo_rect'）。
        # 画面はアドオンの名前ではなくこれで部品を選ぶ。無い・画面が知らない値なら、
        # params から入力欄を描いて実行するだけの汎用の画面になる（アドオンを足しても画面の作り直しは要らない）
        'player_ui': meta.get('player_ui') or None,
        # target='language' の言語のコード（'en' など）。アプリの表示言語の選択肢になる
        'lang': str(meta.get('lang') or '') or None,
        # target='cm_analysis' が結果に書き足す鍵を、分割画面にどう出すか。
        # [{key, kind:'range'|'point', label, short?, color?, jump?, near_sec?, annotate?}]。
        # 画面はアドオンの名前や鍵を知らず、これだけを見て帯・凡例・▼を描く
        'marks': [m for m in (meta.get('marks') or []) if isinstance(m, dict) and m.get('key')],
        # 設定画面の実行ボタンの名前。通知の疎通確認以外にも使うため
        # (例: バイナリの更新)、アドオン側で名乗れるようにする
        # 番組表(guide)の番組を録画できるアドオン。番組表はこれを見て
        # 予約ボタンを出し、fire(event='reserve') を投げる
        'records_guide': bool(meta.get('records_guide')),
        # provides_scan: 録画の番組情報を自分で出せる。コアが EIT を読む前に聞きに来る
        'provides_scan': bool(meta.get('provides_scan')),
        # 順番待ちのレーン名。同じ名前のアドオンは1本ずつ順に流す（CPU/QSV を
        # 長時間使うもの用。無ければ従来どおり頼まれた順に並行実行する）
        'queue': meta.get('queue') or None,
        # エンコードキュー(エンコードの実行)へ載せる。QSV は1つしかないので、
        # Amatsukaze のエンコードと同じ行列に並べないと食い合う。
        # 立てると、実行の口はレーンではなく encodings の行を作る側へ回り、
        # 順番・一時停止・進捗・画面表示がエンコードと同じ仕組みに乗る。
        'encode_queue': bool(meta.get('encode_queue')),
        # 利用者へ渡すファイル（切り抜きの MP4 など）を server/data/addon/<名前>/ に作る時の寿命（秒）。
        # 立てると /api/addons/<名前>/files/<ファイル> で配り（送り切ったら消す）、過ぎた分は片付けで消す
        'output_ttl_sec': int(meta.get('output_ttl_sec') or 0) or None,
    }
