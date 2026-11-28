// 分割画面の CM解析まわり（元の split.jsx の cmRanges・chaptersIn・flipBlocks・segMutes など）。
// CM解析は録画登録スキャンが作る参考の結果で、分割（segments）には押した時だけ反映する

/** GET /api/encode/recordings/<id>/cm_analysis の result（使う所だけ） */
export interface CmResult {
  trim_segments?: { start: number; end: number }[];
  jls_segments?: { start: number; end: number; label: string }[];
  mutes?: { start: number; end?: number; scene_sec?: number; scene_frame?: number; start_frame?: number; frame?: number }[];
  scenes?: { sec: number; frame?: number }[];
  scenes_all?: { sec: number; frame?: number }[];
  kept_sec?: number;
  total_sec?: number;
  logos?: string[];
  /** CM解析のアドオン（target='cm_analysis'）が書き足した鍵。中身はアドオンが marks で名乗る */
  [addonKey: string]: unknown;
}

/**
 * CM解析のアドオンが書き足した鍵の出し方（アドオンの ADDON['marks']）。画面はアドオンの名前も鍵も知らず、これだけで描く
 */
export interface CmMarkDecl {
  key: string;
  /** range: start〜end の区間 / point: sec（無ければ start）の位置 */
  kind: 'range' | 'point' | string;
  label: string;
  /** ▼の説明に出す短い名前 */
  short?: string;
  color?: string;
  /** ▼の飛び先に足すか（range は両端） */
  jump?: boolean;
  /** この秒数より近くに▼があれば足さない（既定 0.3） */
  near_sec?: number;
  /** 足さなかった時、その▼に印を添えるか（既定 true） */
  annotate?: boolean;
}
export type MarkItem = { start?: number; end?: number; sec?: number; frame?: number; start_frame?: number; end_frame?: number; removed_sec?: number };
/** アドオンが書き足した鍵の中身（配列でなければ空） */
export const cmAddonItems = (cm: CmResult | null | undefined, key: string): MarkItem[] => {
  const v = cm?.[key];
  return Array.isArray(v) ? (v as MarkItem[]) : [];
};
/** 位置の印の秒とコマ */
export const cmPointAt = (x: MarkItem) => ({ sec: x.sec ?? x.start ?? 0, frame: x.frame ?? x.start_frame });
export interface CmJob { state: 'queued' | 'running' | 'done' | 'error' | string; queue_position?: number; error?: string | null }
export interface CmAnalysis { ready?: boolean; result?: CmResult; job?: CmJob | null; error?: string | null }
/** サーバーが導出したチャプター（話ごと。start/end は出力の時間、src/src_end は元の時間） */
export interface SegChapter { start: number; end: number; name: string; label: string; keep_index: number; src: number; src_end: number }

/** JoinLogoScp の区分の呼び名。CM系は除去される側 */
const CHAPTER_LABELS: Record<string, string> = { L: '本編', Mix: '本編', CM: 'CM', Nologo: 'ロゴなし', 'Trailer(add)': '予告', 'Sponsor(add)': '提供' };
export const chapterName = (label: string | null | undefined) => CHAPTER_LABELS[label ?? ''] || label || '?';
export const isCmLabel = (label: string | null | undefined) => ['CM', 'Trailer(add)', 'Sponsor(add)'].includes(String(label || ''));

/** CM（除去される所）= 残す区間の補集合 */
export function cmRanges(cm: CmResult | null, total: number): [number, number][] {
  const segs = cm?.trim_segments ?? [];
  if (!segs.length || !total) return [];
  const out: [number, number][] = [];
  let cur = 0;
  for (const s of segs) { if (cur < s.start) out.push([cur, s.start]); cur = Math.max(cur, s.end); }
  if (cur < total) out.push([cur, total]);
  return out;
}

