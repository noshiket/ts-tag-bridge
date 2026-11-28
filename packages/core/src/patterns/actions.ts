// パターンの ANALYZE アクション（元の encode.jsx の ACTION_SCHEMA / rawToAction / actionsToAnalyze など）。
// 画面では {type, field, str, …} の形で編集し、保存する時にサーバーの analyze の形（{setStr: 'title', str: …}）へ戻す

export interface ActionParam {
  key: string; label: string; type: string; required: boolean; default?: unknown; description?: string;
  available_sources?: { key: string; desc: string }[];
  /** template_string で、同じアクション列の出力フィールド（{$title} 等）も差し込めるようにする */
  refs_fields?: boolean;
}
export interface ActionDef {
  key: string; label: string; description: string; output_type: string; params: ActionParam[];
  /** アドオンが足したアクションなら、そのアドオンの名前（サーバーの定義にだけ付く） */
  addon?: string;
  /** 文字を取ってきて、その文字に入れ子の pattern / analyze をかける型（副題の取得など） */
  fetch_text?: boolean;
  /** 予行検索（/api/addons/<addon>/search）ができる */
  searchable?: boolean;
}
/** 画面で編集する形のアクション */
export type Action = { type: string; field?: string; str?: string; analyze?: Action[]; [k: string]: unknown };
export type RawAction = Record<string, unknown>;

// mirrors GET /api/patterns/actives
export const ACTION_SCHEMA: ActionDef[] = [
  { key: 'setStr', label: '文字列セット', description: 'フィールドに文字列をセット。{$N} 形式のプレースホルダー使用可。from/to で置換可', output_type: 'string',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'title', description: 'title / subtitle / folder など' },
      { key: 'str', label: '値', type: 'template_string', required: true, description: '{$N} または固定文字列' },
      { key: 'from', label: '置換元(正規表現)', type: 'string', required: false, description: '指定時、生成値に re.sub 置換を適用' },
      { key: 'to', label: '置換後', type: 'string', required: false, description: 'from の置換後（\\1 で後方参照）' },
    ] },
  { key: 'setNum', label: '数値セット', description: 'フィールドに数値をセット（話数・シーズン等）', output_type: 'number',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'episode_number', description: 'episode / season など' },
      { key: 'str', label: '値', type: 'template_string', required: true, description: '{$N} または固定数値文字列' },
    ] },
  { key: 'setSubtitles', label: 'サブタイトルリスト', description: '区切り文字で分割してリストに設定', output_type: 'array<string>',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'episode_name', description: 'subtitles など' },
      { key: 'str', label: '値', type: 'template_string', required: true, description: '{$N}' },
      { key: 'separator', label: '区切り文字', type: 'string', required: false, default: '#', description: 'デフォルト: #' },
    ] },
  { key: 'pattern', label: '入れ子パターン解析', description: '別テキストを別パターンで再帰解析', output_type: 'depends_on_nested_analyze',
    params: [
      { key: 'text', label: '解析対象テキスト', type: 'text_source', required: true, description: '$title / $description / $extended_info' },
      { key: 'analyze', label: 'ネスト ANALYZE', type: 'array<analyze>', required: false, default: [] },
    ] },
  { key: 'getEpisodeFromSid', label: '話数取得（SID）', description: 'SID + 放送日時 → 話数をAPI取得', output_type: 'number',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'episode_number' },
      { key: 'sid', label: 'SID ($context)', type: 'context_ref', required: true, default: '$sid' },
      { key: 'startTimeField', label: '放送日時 ($context)', type: 'context_ref', required: false, default: '$start_time' },
    ] },
  { key: 'getShoboiSubtitle', label: 'サブタイトル取得（TID）', description: 'しょぼいカレンダーTID + 話数 → サブタイトル取得', output_type: 'string',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'episode_name' },
      { key: 'tid', label: 'TID（数値）', type: 'string', required: true, description: 'しょぼいカレンダーの TID' },
      { key: 'episodeField', label: '話数フィールド名', type: 'field_ref', required: false, default: 'episode_number' },
    ] },
  { key: 'getShoboiEpisode', label: '話数逆引き（サブタイトル→話数）', description: 'しょぼいカレンダーTID + サブタイトル → 話数取得', output_type: 'number',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'episode_number' },
      { key: 'tid', label: 'TID（数値）', type: 'string', required: true },
      { key: 'subtitleField', label: 'サブタイトルフィールド名', type: 'field_ref', required: false, default: 'episode_name' },
    ] },
  { key: 'getFromSid', label: '一括取得（SID）', description: 'SID + 放送日時 → 複数フィールドをAPI取得', output_type: 'mapped_fields',
    params: [
      { key: 'sid', label: 'SID ($context)', type: 'context_ref', required: true, default: '$sid' },
      { key: 'startTimeField', label: '放送日時 ($context)', type: 'context_ref', required: false, default: '$start_time' },
      { key: 'set', label: '取得→出力マップ', type: 'source_to_dest_map', required: true,
        default: { 'sid-episode_name': 'episode_name', 'sid-episode_number': 'episode_number', 'sid-furigana': 'furigana', 'sid-short_title': 'title', 'sid-wiki_title': 'folder' },
        available_sources: [
          { key: 'sid-episode_number', desc: '話数' },
          { key: 'sid-episode_name', desc: 'サブタイトル' },
          { key: 'sid-title', desc: '作品タイトル' },
          { key: 'sid-short_title', desc: 'タイトル略称' },
          { key: 'sid-furigana', desc: '読み仮名' },
          { key: 'sid-tid', desc: 'TID' },
          { key: 'sid-wiki_title', desc: 'Wikiタイトル' },
          { key: 'sid-announce', desc: '告知文' },
        ] },
    ] },
  { key: 'getFromTitleAndEpisode', label: '一括取得（タイトル＋話数）', description: 'タイトル + 話数 → 複数フィールドをAPI取得', output_type: 'mapped_fields',
    params: [
      { key: 'title', label: 'タイトル値', type: 'template_string', required: true, default: '{$1}' },
      { key: 'episodeField', label: '話数フィールド名', type: 'field_ref', required: false, default: 'episode' },
      { key: 'set', label: '取得→出力マップ', type: 'source_to_dest_map', required: true,
        available_sources: [
          { key: 't-title', desc: '作品タイトル' },
          { key: 't-short_title', desc: 'タイトル略称' },
          { key: 't-furigana', desc: '読み仮名' },
          { key: 't-episode_name', desc: 'サブタイトル' },
          { key: 't-tid', desc: 'TID' },
          { key: 't-wiki_title', desc: 'Wikiタイトル' },
        ] },
    ] },
  { key: 'addList', label: 'リスト追加', description: 'フィールドのリストに値を追加', output_type: 'array<string>',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'category' },
      { key: 'str', label: '追加値', type: 'template_string', required: true },
    ] },
  { key: 'setPath', label: '出力パス生成', description: 'パステンプレートを展開して出力パスを設定。{$output_field} は遅延解決、{$context_var} は即時解決', output_type: 'string',
    params: [
      { key: 'field', label: '出力フィールド名', type: 'field_ref', required: true, default: 'app_output_path' },
      { key: 'str', label: 'パステンプレート', type: 'path_template', required: true },
    ] },
  { key: 'switch', label: '条件分岐', description: 'キャプチャグループの値で分岐（switch/list/else）', output_type: 'depends_on_branch',
    params: [
      { key: 'switch', label: '分岐キー ($N or $varname)', type: 'placeholder_ref', required: true, description: '{$1} など' },
    ] },
];

export const OUTPUT_FIELDS = ['title', 'episode_number', 'episode_name', 'folder', 'furigana', 'auto_send'];
export const CONTEXT_REFS = ['$sid', '$start_time', '$title', '$description', '$extended_info', '$service_name', '$onid', '$tsid'];
export const TEMPLATE_PLACEHOLDERS = ['{$1}', '{$2}', '{$3}', '{$4}'];
export const PATH_CONTEXT_VARS = ['{$encode_dir}', '{$ext}', '{$start_time}', '{$sid}', '{$service_name}', '{$onid}', '{$tsid}'];

/** サーバーの analyze 1件 → 編集する形。どの定義にも当たらなければ null */
/**
 * 組み込みの定義に、サーバーの定義にあるアドオンのアクション（addon 付き）を足す。
 * 文字を取ってくる型は pattern キーを持つので、pattern / switch より前に置く（rawToAction は先に一致した定義を採る。
 * 後ろだと保存済みのものが入れ子のパターンとして戻り sid などが消える。サーバーの text_parser も同じ順）
 */
export function withAddonActions(base: ActionDef[], server: ActionDef[]): ActionDef[] {
  const have = new Set(base.map((a) => a.key));
  const add = server.filter((a) => a.addon && !have.has(a.key));
  const at = base.findIndex((a) => a.key === 'switch' || a.key === 'pattern');
  const i = at < 0 ? base.length : at;
  return [...base.slice(0, i), ...add.filter((a) => a.fetch_text), ...base.slice(i), ...add.filter((a) => !a.fetch_text)];
}

export function rawToAction(raw: RawAction, schema: ActionDef[] = ACTION_SCHEMA): Action | null {
  // スキーマが空だと全部 null になり、保存で analyze が消えるので既定へ戻す
  const defs = schema.length ? schema : ACTION_SCHEMA;
  for (const def of defs) {
    if (!(def.key in raw)) continue;
    const action: Action = { type: def.key };
    if (def.params[0]?.key === 'field') action.field = raw[def.key] as string;
    else action[def.key] = raw[def.key];
    for (const p of def.params) {
      if (p.key === 'field') continue;
      if (p.type === 'array<analyze>') action[p.key] = ((raw[p.key] as RawAction[] | undefined) ?? []).map((r) => rawToAction(r, defs)).filter((x): x is Action => !!x);
      else if (p.key in raw) action[p.key] = raw[p.key];
    }
    return action;
  }
  return null;
}

/** 編集する形 → サーバーの analyze */
export function actionsToAnalyze(actions: Action[], schema: ActionDef[] = ACTION_SCHEMA): RawAction[] {
  const defs = schema.length ? schema : ACTION_SCHEMA;
  return actions.map((a) => {
    const def = defs.find((d) => d.key === a.type);
    if (!def) return {};
    const raw: RawAction = {};
    if (def.params[0]?.key === 'field') raw[def.key] = a.field || '';
    else raw[def.key] = a[def.key] !== undefined ? a[def.key] : '_placeholder';
    for (const p of def.params) {
      if (p.key === 'field') continue;
      if (p.type === 'array<analyze>') raw[p.key] = actionsToAnalyze((a[p.key] as Action[] | undefined) ?? [], defs);
      else if (p.type === 'source_to_dest_map') raw[p.key] = a[p.key] || {};
      else if (a[p.key] !== undefined) raw[p.key] = a[p.key];
      else if (p.default !== undefined) raw[p.key] = p.default;
    }
    return raw;
  });
}

/** 予行検索用: アクションが入れる出力フィールドの値（{$N} はビルダーで選んだ文字で埋める） */
export function actionFieldValues(actions: Action[], groups: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of actions) {
    if (!a?.field || typeof a.str !== 'string') continue;
    if (!['setStr', 'setNum', 'setSubtitles', 'addList'].includes(a.type)) continue;
    out[a.field] = a.str.replace(/\{\$(\d+)\}/g, (m, n: string) => groups[n] ?? m);
  }
  return out;
}

/** パターンの {$N} の数から、ありそうな始めのアクション */
export function defaultActions(pattern: string, outputPath: string): Action[] {
  const g = [...(pattern || '').matchAll(/\{\$(\d+)\}/g)].map((m) => +m[1]!);
  const first = g[0] ? `{$${g[0]}}` : '{$1}';
  const actions: Action[] = [{ type: 'setStr', field: 'title', str: first }];
  if (g[1]) actions.push({ type: 'setNum', field: 'episode_number', str: `{$${g[1]}}` });
  if (g[2]) actions.push({ type: 'setStr', field: 'subtitle', str: `{$${g[2]}}` });
  actions.push({ type: 'setStr', field: 'folder', str: first });
  actions.push({ type: 'setPath', field: 'app_output_path', str: outputPath || '' });
  return actions;
}
