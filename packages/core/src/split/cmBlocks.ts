// 分割画面のブロック（区切りで分けた、押して採用/除外する単位）と、CM解析からの採用区間
import type { KeepRange, TimeRange } from './source';
import type { CmResult } from './cmResult';

export interface Block { start: number; end: number; label: string }

/**
 * その話を区切りで分けたブロック（押して採用/除外する単位）。区切りはチャプターの境目と、
 * 無音区間（解析ぶんと手で足したぶん）の真ん中。狭いものも落とさない（落とすと区切りが消える）
 */
export function blocksIn(cm: CmResult | null, s: { start: number; end: number }, manual: TimeRange[] = []): Block[] {
  if (!cm && !manual.length) return [];
  const chapters = (cm?.jls_segments ?? []).map((c) => ({ start: c.start, end: c.end, label: c.label }));
  const bounds = [s.start, s.end];
  for (const c of chapters) {
    if (c.start > s.start && c.start < s.end) bounds.push(c.start);
    if (c.end > s.start && c.end < s.end) bounds.push(c.end);
  }
  const mids = [...(cm?.mutes ?? []).map((m) => (m.start + (m.end ?? m.start)) / 2), ...manual.map((m) => (m.from + (m.to ?? m.from)) / 2)];
  for (const mid of mids) if (mid > s.start && mid < s.end) bounds.push(mid);
  const cuts = [...new Set(bounds.map((b) => Math.round(b * 1000) / 1000))].sort((a, b) => a - b);
  const out: Block[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const mid = (start + end) / 2;
    const ch = chapters.find((c) => mid >= c.start && mid <= c.end);
    out.push({ start, end, label: ch ? ch.label : '' });
  }
  return out;
}

/** 採用区間が空の話は「全体を採用」なので、どのブロックも採用 */
export function isKeptBlock(keeps: KeepRange[], b: Block): boolean {
  if (!keeps.length) return true;
  const mid = (b.start + b.end) / 2;
  return keeps.some((k) => mid >= k.from && mid <= k.to);
}

/** 手で付けた名前だけ引き継ぐ（自動では付けない。付けると Amatsukaze の名前と混ざる） */
export function withAmzNames(prevKeeps: KeepRange[], ranges: KeepRange[]): KeepRange[] {
  return ranges.map((r) => {
    const p = prevKeeps.find((x) => Math.abs(x.from - r.from) < 0.5);
    return p?.name ? { ...r, name: p.name } : r;
  });
}

/** hit が true のブロックの採用/除外を反転し、隣り合う採用は1つの区間にまとめた採用区間を返す */
export function flipBlocks(blocks: Block[], keeps: KeepRange[], hit: (b: Block) => boolean): KeepRange[] {
  const kept = new Set(blocks.filter((b) => isKeptBlock(keeps, b)).map((b) => b.start));
  for (const b of blocks) if (hit(b)) { if (kept.has(b.start)) kept.delete(b.start); else kept.add(b.start); }
  const ranges: KeepRange[] = [];
  for (const b of blocks) {
    if (!kept.has(b.start)) continue;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(b.start - last.to) < 0.5) last.to = b.end;
    else ranges.push({ from: b.start, to: b.end });
  }
  return withAmzNames(keeps, ranges);
}

/** 解析の「残す区間」をその話へ切り出し、手で足した無音の真ん中で割る（CM反映） */
export function cmKeepsFor(cm: CmResult | null, s: { start: number; end: number }, manual: TimeRange[] = [], prevKeeps: KeepRange[] = []): KeepRange[] {
  const ranges = (cm?.trim_segments ?? []).filter((t) => t.end > s.start && t.start < s.end)
    .map((t) => ({ from: Math.max(t.start, s.start), to: Math.min(t.end, s.end) }));
  const mids = manual.map((m) => (m.from + (m.to ?? m.from)) / 2);
  const split: KeepRange[] = [];
  for (const r of ranges) {
    let cur = r.from;
    for (const t of mids.filter((x) => x > r.from + 0.05 && x < r.to - 0.05).sort((a, b) => a - b)) { split.push({ ...r, from: cur, to: t }); cur = t; }
    split.push({ ...r, from: cur, to: r.to });
  }
  return withAmzNames(prevKeeps, split);
}

