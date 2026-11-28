// ファイル名の決め方（設定の output_path・パターンの setPath）で使える変数と、その例。
// 中身はサーバーの text_parser の展開（parser/analyze.py の _resolve_set_path・paths.py）に合わせる。

export interface PathVar {
  key: string;
  label: string;
  /** 例の値（架空）。パスに入る形で書く */
  example: string;
}

export interface PathVarGroup {
  title: string;
  note: string;
  vars: PathVar[];
  /** パスには入れず、パターンの中（$sid のように）でだけ使うもの */
  patternOnly?: boolean;
}

export const PATH_VAR_GROUPS: PathVarGroup[] = [
  {
    title: '解析した値（パターンの出力）',
    note: 'パターンが番組名から取り出した値。ライブラリのアルバム・シリーズにもなる。番組の情報と同じ名前なら、こちらが勝つ',
    vars: [
      { key: 'folder', label: '作品名（アルバム・フォルダ）', example: '星のかけら' },
      { key: 'title', label: 'シリーズ名（期などを含む）', example: '星のかけら 第2期' },
      { key: 'episode_number', label: '話数', example: '03' },
      { key: 'episode_name', label: 'サブタイトル', example: 'はじまりの朝' },
      { key: 'furigana', label: 'ふりがな', example: 'ほしのかけら' },
    ],
  },
  {
    title: '番組の情報（パーサーへ渡す値）',
    note: '録画・予約の番組情報から text_parser へ渡す値。パターンの中でも $sid のように使える。設定の text_parser_context に書いた値も同じく渡る',
    vars: [
      { key: 'service_name', label: '局名', example: 'QZX総合' },
      { key: 'start_time', label: '放送開始（パスでは 年月日-時分 に直る）', example: '20251122-2300' },
      { key: 'setting', label: '番組名の [ ] の部分（番組名からは外される）', example: '[字][再]' },
      { key: 'sid', label: 'サービス ID', example: '1024' },
      { key: 'onid', label: 'ネットワーク ID', example: '32736' },
      { key: 'tsid', label: 'TS ID', example: '32736' },
    ],
  },
  {
    title: '番組の情報（パターンの中だけ）',
    note: 'パーサーへは渡るが、長い文なのでパスには向かない',
    patternOnly: true,
    vars: [
      { key: 'title', label: '番組名（EPG のまま。[ ] は外したもの）', example: '星のかけら 第2期 #3「はじまりの朝」' },
      { key: 'description', label: '番組説明', example: '' },
      { key: 'extended_info', label: '番組詳細', example: '' },
    ],
  },
  {
    title: '保存の時に決まる値',
    note: '解析の時は {$encode_dir} のまま残り、エンコード後に保存する時に入る',
    vars: [
      { key: 'encode_dir', label: '保存先（録画ごとに選ぶ。未選択は保存先の一覧の先頭）', example: '/mnt/encoded1' },
      { key: 'ext', label: '拡張子（設定の text_parser_context.ext）', example: '.mp4' },
    ],
  },
];

/** 書き方の決まり（画面の注意書き） */
export const PATH_TEMPLATE_RULES = [
  '{$名前} のほか $名前 でも書ける',
  '値の中のファイル名に使えない文字（/ ? ! など）は全角に置き換わる（保存先と拡張子はそのまま）',
  '値の無い変数は {$名前} のまま残る',
];

/** テンプレートを例の値で展開する（画面の「例」用）。サーバーと同じく、解析した値を番組の情報より先に引く */
export function expandPathExample(template: string): string {
  const values: Record<string, string> = {};
  for (const g of PATH_VAR_GROUPS) {
    if (g.patternOnly) continue;
    for (const v of g.vars) if (!(v.key in values)) values[v.key] = v.example;
  }
  const rep = (m: string, k: string) => (k in values ? values[k]! : m);
  return template.replace(/\{\$([A-Za-z_]\w*)\}/g, rep).replace(/\$([A-Za-z_]\w*)/g, rep);
}
