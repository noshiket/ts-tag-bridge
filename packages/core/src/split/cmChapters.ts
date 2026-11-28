// 分割画面のチャプター（出力の時間での名前・入力のチャプター・採用した区間のチャプター）とブロックのまとめ
import type { KeepRange } from './source';
import type { Block } from './cmBlocks';
import { chapterName, type CmResult, type SegChapter } from './cmResult';

/** 元の時間 → その話の出力の時間（採用区間の外なら null） */
export function toOutTime(keeps: KeepRange[], segStart: number, t: number): number | null {
  const ks = [...keeps].sort((a, b) => a.from - b.from);
  if (!ks.length) return t - segStart;
  let acc = 0;
  for (const k of ks) { if (t >= k.from && t < k.to) return acc + (t - k.from); acc += k.to - k.from; }
  return null;
}

/** その元の時間に当たるチャプター名（サーバー導出のチャプターから） */
export function chapterNameAt(chs: SegChapter[], keeps: KeepRange[], segStart: number, t: number): string {
  const o = toOutTime(keeps, segStart, t);
  if (o == null) return '';
  const hit = [...chs].reverse().find((c) => c.start <= o + 0.6);
  return hit ? hit.name : '';
}

/** 入力タイムライン（元の時間）の位置のチャプター名。解析の残す区間を通して出力の時間へ直して引く */
export function inputChapterAt(cm: CmResult | null, inputChapters: SegChapter[], t: number): string {
  let acc = 0;
  for (const tr of cm?.trim_segments ?? []) {
    if (t >= tr.start && t < tr.end) {
      const out = acc + (t - tr.start);
      const hit = [...inputChapters].reverse().find((c) => c.start <= out + 0.6);
      return hit ? hit.name : '';
    }
    acc += tr.end - tr.start;
  }
  return '';
}

/** その採用区間（並べた時の番号）に入るチャプター */
export function keepChapters(chs: SegChapter[], keeps: KeepRange[], from: number): SegChapter[] {
  const ki = [...keeps].sort((a, b) => a.from - b.from).findIndex((k) => Math.abs(k.from - from) < 0.001);
  return chs.filter((c) => c.keep_index === ki);
}

/** 本編と CM でまとめた長さ（ブロック帯の下の合計） */
export function blockSummary(blocks: Block[]): [string, number][] {
  const sum: Record<string, number> = {};
  for (const b of blocks) { const k = chapterName(b.label); sum[k] = (sum[k] || 0) + (b.end - b.start); }
  return Object.entries(sum);
}

