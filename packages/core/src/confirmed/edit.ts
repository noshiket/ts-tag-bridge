// 解析確定値の編集（元の Web 版の detail.jsx の ConfirmedFieldEditor と同じ決め方）。
// 予約(録画ルール)・録画・ライブラリの動画で、保存先と「並び（複数話）で持つ列」が違う

/** 何の確定値か。rule = 予約の録画ルール / recording = 録画 / video = ライブラリの動画 */
export type ConfirmedKind = 'rule' | 'recording' | 'video';

export interface ConfirmedField {
  key: string;
  /** 英字の短い名前（入力欄の見出し） */
  label: string;
  /** 日本語の名前（入力欄の中の薄い字） */
  ja: string;
  bool?: boolean;
}

export const CONFIRMED_FIELDS: ConfirmedField[] = [
  { key: 'title', label: 'title', ja: 'タイトル' },
  { key: 'folder', label: 'folder', ja: 'フォルダ' },
  { key: 'episode_name', label: 'ep_name', ja: 'エピソード名' },
  { key: 'episode_number', label: 'ep_num', ja: 'エピソード番号' },
  { key: 'category', label: 'category', ja: 'カテゴリ' },
  { key: 'furigana', label: 'furigana', ja: 'ふりがな' },
  { key: 'else_info', label: 'else', ja: 'その他' },
  { key: 'auto_send', label: 'auto_send', ja: '自動送信', bool: true },
  { key: 'app_output_path_format', label: 'path_fmt', ja: 'パス形式' },
  { key: 'app_output_path', label: 'out_path', ja: '出力パス' },
  { key: 'setting', label: 'setting', ja: '設定情報' },
];

/** 解析結果の名前 → 確定値の列 */
export const TP_TO_DB: Record<string, string> = {
  title: 'title', folder: 'folder', episode_name: 'episode_name', 't-episode_name': 'episode_name',
  episode_number: 'episode_number', category: 'category', furigana: 'furigana', else: 'else_info',
  auto_send: 'auto_send', app_output_path: 'app_output_path', app_output_path_format: 'app_output_path_format', setting: 'setting',
};

/** 話数ごとに並びになる解析結果（サーバーの _PER_EPISODE_TP_FIELDS） */
const PER_EPISODE = new Set(['episode_number', 'episode_name', 't-episode_name']);

/** 何行か書ける列 */
export const MULTILINE_COLS = new Set(['episode_name', 'app_output_path', 'app_output_path_format']);

/** 並び（複数話）で持つ列。録画とルールは複数話を持ちうる。動画はエンコード後の1話なのでカテゴリだけ */
export const listColsOf = (kind: ConfirmedKind) => kind === 'video'
  ? new Set(['category'])
  : new Set(['title', 'furigana', 'folder', 'setting', 'episode_number', 'episode_name', 'category', 'app_output_path']);

/**
 * 並びを編集中は1本の文字列で持つ。つなぐ記号は名前に出てこない ␟ にする
 * （「, 」でつないで分け直すと、副題の「Hello, World」が2話ぶんに分かれた。元と同じ）
 */
export const LIST_SEP = '␟';

export type ConfirmedValues = Record<string, string>;

export function joinVal(key: string, v: unknown, listCols: Set<string>): string {
  if (Array.isArray(v)) return v.join(listCols.has(key) ? LIST_SEP : ', ');
  return v == null ? '' : String(v);
}
export const splitList = (s: string) => String(s || '').split(LIST_SEP).map((x) => x.trim());

/** 編集の始めの値（並びの列は JSON の文字列で届くこともある） */
export function initConfirmedValues(confirmed: Record<string, unknown> | null | undefined, kind: ConfirmedKind): ConfirmedValues {
  const c = confirmed || {};
  const lists = listColsOf(kind);
  const out: ConfirmedValues = {};
  for (const f of CONFIRMED_FIELDS) {
    let v = c[f.key];
    if (v == null) { out[f.key] = ''; continue; }
    if (lists.has(f.key) && typeof v === 'string' && v.startsWith('[')) {
      try { v = JSON.parse(v); } catch { /* そのまま */ }
    }
    out[f.key] = joinVal(f.key, v, lists);
  }
  // 出力先のディスク（解析の値ではない）。未選択は空
  out.encode_dir = c.encode_dir != null ? String(c.encode_dir) : '';
  return out;
}

const oneEpisode = (tpKey: string, v: unknown, idx: number) =>
  PER_EPISODE.has(tpKey) && Array.isArray(v) ? (idx < v.length ? v[idx] : v[0]) : v;

/**
 * 解析結果を全項目へ反映する。解析結果に無い列は空にする（前の解析の値が残って混ざらないように）。
 * 話数の並びは idx の話に絞る
 */
export function applyAllTp(vals: ConfirmedValues, tp: Record<string, unknown>, kind: ConfirmedKind, idx = 0): ConfirmedValues {
  const lists = listColsOf(kind);
  const filled: ConfirmedValues = {};
  for (const [tpKey, dbKey] of Object.entries(TP_TO_DB)) {
    const v = tp[tpKey];
    if (v == null) continue;
    filled[dbKey] = joinVal(dbKey, oneEpisode(tpKey, v, idx), lists);
  }
  const next = { ...vals };
  for (const dbKey of new Set(Object.values(TP_TO_DB))) next[dbKey] = filled[dbKey] ?? '';
  return next;
}

/** 解析結果の1項目を反映する */
export function applyTpKey(vals: ConfirmedValues, tp: Record<string, unknown>, tpKey: string, kind: ConfirmedKind): ConfirmedValues {
  const dbKey = TP_TO_DB[tpKey];
  const v = tp[tpKey];
  if (!dbKey || v == null) return vals;
  return { ...vals, [dbKey]: joinVal(dbKey, v, listColsOf(kind)) };
}

/** 「反映して保存」: 解析結果にある項目だけ上書きする（無い項目は今の値のまま） */
export function applyPresentTp(vals: ConfirmedValues, tp: Record<string, unknown>, kind: ConfirmedKind): ConfirmedValues {
  const lists = listColsOf(kind);
  const next = { ...vals };
  for (const [tpKey, dbKey] of Object.entries(TP_TO_DB)) {
    if (tp[tpKey] != null) next[dbKey] = joinVal(dbKey, tp[tpKey], lists);
  }
  return next;
}

/** 手で直した時（「その他」以外を直したら「その他」は空にする。元と同じ） */
export const editConfirmed = (vals: ConfirmedValues, key: string, value: string): ConfirmedValues =>
  ({ ...vals, [key]: value, ...(key !== 'else_info' ? { else_info: '' } : {}) });

/** 複数話の動画で採用する話を変える: 全話の解析結果から各項目を作り直す */
export function switchEpisode(vals: ConfirmedValues, fullTp: Record<string, unknown>, idx: number): ConfirmedValues {
  const lists = listColsOf('video');
  const next = { ...vals };
  for (const [tpKey, dbKey] of Object.entries(TP_TO_DB)) {
    const v = fullTp[tpKey];
    if (v != null) next[dbKey] = joinVal(dbKey, oneEpisode(tpKey, v, idx), lists);
  }
  return next;
}

/** 自動送信: 1〜5 = その優先度で自動でキューに入れる、0 = なし。解析の true は 3、false は 0 */
export function normalizeAutoSend(v: string): number | '' {
  if (v === '') return '';
  const s = v.trim().toLowerCase();
  const n = s === 'true' ? 3 : s === 'false' ? 0 : Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.trunc(n))) : 0;
}

/**
 * 保存する中身。manual: 手で直した（is_text_parser=0）。並びの列は配列に戻す
 * （複数の時は空も位置として残し、1つだけの空は null）。ルールには encode_dir の列が無いので送らない
 */
export function confirmedSaveBody(vals: ConfirmedValues, kind: ConfirmedKind, opts: { manual: boolean; parserError: unknown; episodeIdx?: number }) {
  const body: Record<string, unknown> = { ...vals, is_text_parser: opts.manual ? 0 : 1, parser_error: opts.parserError ?? null };
  body.auto_send = normalizeAutoSend(vals.auto_send ?? '');
  for (const col of listColsOf(kind)) {
    const s = body[col];
    if (typeof s !== 'string') continue;
    const parts = splitList(s);
    body[col] = parts.length > 1 ? parts : parts[0] || null;
  }
  if (kind === 'rule') delete body.encode_dir;
  if (kind === 'video' && opts.episodeIdx != null) body.episode_idx = opts.episodeIdx;
  return body;
}

/** パス形式の解決に渡す値（並びは配列に戻す） */
export function resolveFields(vals: ConfirmedValues, tpSetting: unknown) {
  const split = (v: string) => {
    if (!v) return '';
    const parts = v.split(LIST_SEP);
    return parts.length > 1 ? parts : parts[0] || '';
  };
  return {
    title: split(vals.title ?? ''), folder: split(vals.folder ?? ''), episode_number: split(vals.episode_number ?? ''),
    episode_name: split(vals.episode_name ?? ''), furigana: split(vals.furigana ?? ''), category: split(vals.category ?? ''),
    setting: split(vals.setting || (typeof tpSetting === 'string' ? tpSetting : '') || ''), else: vals.else_info ?? '',
  };
}
