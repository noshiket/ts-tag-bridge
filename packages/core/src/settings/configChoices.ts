// 設定の「アプリ」で、数字や場所を手で書かせずに選ばせるための候補と読み替え

/** ワーカーの間隔（秒）の候補 */
export const INTERVAL_CHOICES: [number, string][] = [[15, '15秒'], [30, '30秒'], [60, '1分'], [120, '2分'], [300, '5分'], [600, '10分']];

/** 間隔の選択肢。今の値が候補に無ければ、それも「今の値」として足す（勝手に変えない） */
export function intervalOptions(current: unknown): [string, string][] {
  const opts: [string, string][] = INTERVAL_CHOICES.map(([v, l]) => [String(v), l]);
  const cur = String(current ?? '').trim();
  if (cur && !opts.some(([v]) => v === cur)) opts.unshift([cur, `${cur}秒（今の値）`]);
  return opts;
}

/** 急がない解析（CM 解析・音声解析）の重さ。サーバーの logic/encoding/load_weights と同じ鍵 */
export const WEIGHT_OPTIONS: [string, string][] = [
  ['low', '控えめ（他の処理に譲る・時間がかかる）'],
  ['normal', 'ふつう'],
  ['high', '全力（速いが CPU を取り切る）'],
];

export type ToolCandidates = { bundled: string; system: string };
export type ToolChoice = 'bundled' | 'system' | 'custom';

/** ffmpeg・ffprobe の今の値が、同梱版・システムの物・それ以外のどれか */
export function toolChoice(value: unknown, cand: ToolCandidates | undefined): ToolChoice {
  const v = String(value ?? '').trim();
  if (cand?.bundled && v === cand.bundled) return 'bundled';
  if (cand?.system && v === cand.system) return 'system';
  return 'custom';
}

/** 名前と値の組（パーサーコンテキストなど）を、画面で並べる行にする */
export function pairRows(obj: unknown): [string, string][] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, v == null ? '' : String(v)]);
}

/** 行を名前と値の組に戻す（名前が空の行は捨てる） */
export function rowsToPairs(rows: [string, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of rows) if (k.trim()) out[k.trim()] = v;
  return out;
}
