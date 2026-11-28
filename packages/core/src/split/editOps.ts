// 分割の編集の計算（useSplitEditor から使う、状態を持たない部分）: 話の長さから切れ目を出し直す・採用区間の書き換え
import type { KeepRange, TimeRange } from './source';

type Seg = { start: number; end: number };

/** 話の長さの並び → 切れ目（最後の話の後ろは切らない。ミリ秒に丸める。max を超えない） */
function cutsFromDurations(durs: number[], max = Infinity): number[] {
  let pos = 0;
  const out: number[] = [];
  for (let i = 0; i < durs.length - 1; i++) { pos += durs[i]!; out.push(Math.min(Math.round(pos * 1000) / 1000, max)); }
  return out;
}

/**
 * 間隔を変えた時の切れ目: 固定した話の長さはそのまま、他は間隔、余りの話（remIdx。-1 は無し）が差を吸う
 */
export function intervalCuts(segments: Seg[], pinned: Set<number>, stepSec: number, remIdx: number, total: number): number[] {
  const durs = segments.map((s, i) => (i === remIdx ? 0 : pinned.has(i) ? s.end - s.start : stepSec));
  if (remIdx >= 0) durs[remIdx] = Math.max(0, total - durs.reduce((sum, d, i) => (i === remIdx ? sum : sum + d), 0));
  return cutsFromDurations(durs, total);
}

/**
 * 1つの話の長さを変えた時の切れ目（話数は変えない: N話 + 余り1つを保ち、余りが差を吸う）。
 * 余りの話そのものや範囲の外は null（変えない）
 */
export function resizedCuts(segments: Seg[], idx: number, newDur: number, remainderAt: 'start' | 'end', total: number): number[] | null {
  const durs = segments.map((s) => s.end - s.start);
  if (idx < 0 || idx >= durs.length) return null;
  const remIdx = remainderAt === 'end' ? durs.length - 1 : 0;
  if (idx === remIdx) return null;
  let other = 0;
  for (let i = 0; i < durs.length; i++) if (i !== idx && i !== remIdx) other += durs[i]!;
  durs[idx] = Math.max(1, Math.min(total - other - 1, newDur));
  let nonRem = 0;
  for (let i = 0; i < durs.length; i++) if (i !== remIdx) nonRem += durs[i]!;
  durs[remIdx] = Math.max(0, total - nonRem);
  return cutsFromDurations(durs);
}

type KeepList = Record<number, KeepRange[]>;

/** 採用区間の端（from / to）を動かす（0 より前にはしない） */
export function updateKeepEdge(tl: KeepList, segIdx: number, trimIdx: number, field: 'from' | 'to', val: number): KeepList {
  const arr = [...(tl[segIdx] ?? [])];
  arr[trimIdx] = { ...arr[trimIdx]!, [field]: Math.max(0, val) };
  return { ...tl, [segIdx]: arr };
}

/** 採用区間の名前を変える（無ければそのまま） */
export function renameKeepAt(tl: KeepList, segIdx: number, trimIdx: number, name: string): KeepList {
  const arr = [...(tl[segIdx] ?? [])];
  if (!arr[trimIdx]) return tl;
  arr[trimIdx] = { ...arr[trimIdx]!, name };
  return { ...tl, [segIdx]: arr };
}

/**
 * 採用区間を t で2つに割る（隣り合ったまま）。t を内に含む採用区間が無ければ何もしない
 * （採用区間が0個の話は「全体を採用」の意味なので、勝手に区間を作るとトリムの扱いに変わってしまう）
 */
export function splitKeepAtTime(tl: KeepList, segIdx: number, t: number): KeepList {
  const arr = tl[segIdx] ?? [];
  const i = arr.findIndex((k) => k.from < t && t < k.to);
  if (i < 0) return tl;
  const k = arr[i]!;
  const next = [...arr];
  next.splice(i, 1, { ...k, to: t }, { ...k, from: t });
  return { ...tl, [segIdx]: next };
}

/** 手で足す無音区間（前後どちらから押しても from < to。並びは時刻順） */
export function addMuteRange(p: Record<number, TimeRange[]>, segIdx: number, from: number, to: number): Record<number, TimeRange[]> {
  return { ...p, [segIdx]: [...(p[segIdx] ?? []), { from: Math.min(from, to), to: Math.max(from, to) }].sort((a, b) => a.from - b.from) };
}

/** チャプターの名前（元の時刻をミリ秒までの文字で鍵にする。空なら消す） */
export function setChapNameAt(p: Record<number, Record<string, string>>, segIdx: number, srcSec: number, name: string): Record<number, Record<string, string>> {
  const key = Number(srcSec).toFixed(3);
  const cur = { ...(p[segIdx] ?? {}) };
  if (name) cur[key] = name; else delete cur[key];
  return { ...p, [segIdx]: cur };
}
