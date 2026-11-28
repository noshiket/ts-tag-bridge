// 録画の字幕（ARIB）。サーバーが字幕をトークン（文字・位置・大きさ・色）にして返すので、
// 元の Web 版と同じ aribb24.js で解析し、その SVG の描き方で絵にする。
// 元は Canvas に描くが、SVG なら iOS（react-native-svg）でも Web でも同じものが出せる。
import '../util/structuredClone';
import '../util/eucJpDecoder';

import { ARIBB24Parser, svgRenderingStrategy, SVGRenderingOption } from 'aribb24.js';

import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { streamBase, type StreamRef } from './target';

/** GET /api/streams/vdb/<id>/captions-data の1件 */
export interface CaptionEntry {
  /** 動画の頭からの秒 */
  pts: number;
  duration_ms: number | null;
  clear_screen: boolean;
  tokens: Record<string, unknown>[];
}

export const captionsApi = (c: ApiClient) => ({
  data: async (target: StreamRef, track = '1', node?: string | null) =>
    (await c.get<{ captions: CaptionEntry[] }>(nodePath(node, `${streamBase(target)}/captions-data?track=${encodeURIComponent(track)}`))).captions ?? [],
});

/** 画面ひとつ分（ClearScreen から次の ClearScreen まで）。元の buildScreenGroups と同じ */
export interface ScreenGroup {
  start: number;
  end: number;
  captions: CaptionEntry[];
}

export function buildScreenGroups(entries: CaptionEntry[]): ScreenGroup[] {
  const groups: ScreenGroup[] = [];
  let cur: ScreenGroup | null = null;
  for (const e of entries) {
    if (e.clear_screen || !cur) {
      if (cur) groups.push(cur);
      cur = { start: e.pts, end: Infinity, captions: [] };
    }
    cur.captions.push(e);
  }
  if (cur) groups.push(cur);
  for (let i = 0; i + 1 < groups.length; i++) groups[i]!.end = groups[i + 1]!.start;
  for (const g of groups) {
    const last = g.captions[g.captions.length - 1]!;
    if (last.duration_ms != null) g.end = Math.min(g.end, last.pts + last.duration_ms / 1000);
  }
  return groups;
}

/** t 秒に出ている字幕の範囲（画面と、その中で出し終えた字幕の数）。無ければ null */
export function captionAt(groups: ScreenGroup[], t: number): { group: number; count: number } | null {
  let lo = 0;
  let hi = groups.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid]!.start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0 || t > groups[idx]!.end) return null;
  const count = groups[idx]!.captions.filter((c) => c.pts <= t).length;
  return count ? { group: idx, count } : null;
}

// 元の Web 版の ARIBB24_DEFAULT_STATE / ARIBB24_DEFAULT_INFO と同じ
const DEFAULT_STATE = {
  plane: [960, 540], area: [960, 540], margin: [0, 0],
  fontsize: [36, 36], hspace: 4, vspace: 24, position: [0, 59],
  size: 'Normal', pallet: 0,
  foreground: 7, background: 8, halfforeground: 7, halfbackground: 8,
  underline: false, highlight: 0, ornament: null, flashing: 79,
  elapsed_time: 0, end_time: null,
};
const DEFAULT_INFO = { association: 'ARIB', language: 'jpn' };

/** サーバーのトークンを aribb24.js の形へ（元の toARIBB24Token と同じ） */
function toToken(t: Record<string, unknown>): Record<string, unknown> {
  if (t.tag === 'DRCS') {
    const hex = String(t.binary_hex ?? '');
    const bytes = new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    return { ...t, binary: bytes.buffer, combining: t.combining ?? '' };
  }
  if (t.tag === 'NewLine') return { tag: 'ActivePositionReturn' };
  return t;
}

type Node = string | { name: string; xmlns: string; attributes: Record<string, string>; children: Node[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function serialize(n: Node, root = true): string {
  if (typeof n === 'string') return esc(n);
  const attrs = { ...(root ? { xmlns: n.xmlns } : null), ...n.attributes };
  // data-* は描画に使わない（react-native-svg は Web で dataWidth という不明な属性として警告する）
  const a = Object.entries(attrs).filter(([k]) => !k.startsWith('data-')).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
  return `<${n.name}${a}>${n.children.map((c) => serialize(c, false)).join('')}</${n.name}>`;
}

/** 元の Web 版と同じ見た目の指定（黒の縁取り、色は字幕のもの） */
const OPTION = SVGRenderingOption.from({ color: { stroke: 'black', foreground: null, background: null } });

/**
 * t 秒の字幕を SVG の文字列にする（画面全体を覆う。映像に重ねて同じ大きさに伸ばす）。出ていなければ null。
 * 同じ画面・同じ数の字幕なら前と同じ文字列を返す（再生中に何度も作り直さない）
 */
export function captionSvg(groups: ScreenGroup[], t: number, cache: Map<string, string | null>): string | null {
  const at = captionAt(groups, t);
  if (!at) return null;
  const key = `${at.group}:${at.count}`;
  if (cache.has(key)) return cache.get(key)!;
  const tokens = groups[at.group]!.captions.slice(0, at.count).flatMap((c) => c.tokens.map(toToken));
  let svg: string | null = null;
  try {
    const parser = new ARIBB24Parser(DEFAULT_STATE as never);
    const parsed = parser.parse(tokens as never).filter((x: { tag: string }) => x.tag !== 'Bitmap');
    svg = parsed.length ? serialize(svgRenderingStrategy(parsed, DEFAULT_INFO as never, OPTION, true) as Node) : null;
  } catch {
    svg = null;
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, svg);
  return svg;
}
