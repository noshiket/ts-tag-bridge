// 実況コメントを映像の上に流す配置（元の Web 版が使っている weizhenye/Danmaku と同じ動き）。
// 右から左へ一定の速さ(144px/秒)で流し、前のコメントにぶつからない段へ入れる。
// top / bottom は中央に固定して表示する。同時に画面に出る数に上限を設け、超えた分は流さない。
import type { Comment } from './comments';

export interface DanmakuItem {
  key: number;
  text: string;
  color: string;
  mode: 'rtl' | 'top' | 'bottom';
  /** 出始め（動画の秒） */
  time: number;
  /** 表示している秒数 */
  duration: number;
  /** 段（上から何段目か。top は上から、bottom は下から） */
  lane: number;
  /** 文字の幅の見積もり(px) */
  width: number;
}

export interface DanmakuLayout {
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  speed: number;
  items: DanmakuItem[];
}

/** 文字の大きさ（コンテナの幅に比例。KonomiTV と同じ式）。scale は設定の倍率 */
export const danmakuFontSize = (width: number, scale = 1) => 34 * (width / 1024) * 1.25 * scale;

/** 文字幅の見積もり。全角は1文字=文字の大きさ、半角はその 0.55 倍 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0xff ? 1 : 0.55;
  return w * fontSize;
}

export function layoutDanmaku(comments: Comment[], width: number, height: number, opts: { scale?: number; maxOnScreen?: number; speed?: number } = {}): DanmakuLayout {
  const fontSize = danmakuFontSize(width, opts.scale ?? 1);
  const lineHeight = Math.ceil(fontSize * 1.2);
  const speed = opts.speed ?? 144;
  const duration = width / speed;
  const lanes = Math.max(1, Math.floor(height / lineHeight));
  const maxOn = opts.maxOnScreen ?? 100;
  const items: DanmakuItem[] = [];
  // 流れる段ごとに「最後に入れたコメント」（追いつかないかを見る）
  const rtlLast: (DanmakuItem | null)[] = Array(lanes).fill(null);
  // 固定の段ごとに空く時刻
  const topFree: number[] = Array(lanes).fill(-Infinity);
  const bottomFree: number[] = Array(lanes).fill(-Infinity);
  // 同時に画面に出ている数（表示が終わる時刻の昇順）
  const alive: number[] = [];
  let head = 0;

  comments.forEach((c, key) => {
    const mode = c.type === 'top' ? 'top' : c.type === 'bottom' ? 'bottom' : 'rtl';
    const w = estimateTextWidth(c.text, fontSize);
    if (mode === 'rtl') {
      while (head < alive.length && alive[head]! <= c.time) head++;
      if (alive.length - head >= maxOn) return;
      // 入れられる段: 前のコメントが右端から出きっていて、こちらが追いつかない
      const speedOf = (iw: number) => (width + iw) / duration;
      let lane = -1;
      for (let i = 0; i < lanes; i++) {
        const prev = rtlLast[i];
        if (!prev) { lane = i; break; }
        const elapsed = c.time - prev.time;
        const prevTail = width - speedOf(prev.width) * elapsed + prev.width;
        if (prevTail > width) continue;
        // 前のコメントが左端へ消える時までに、こちらがその尻尾へ追いつかないか
        const prevLeft = prev.time + duration;
        const catchUp = width - speedOf(w) * (prevLeft - c.time);
        if (catchUp > 0) { lane = i; break; }
      }
      if (lane < 0) return;
      const item: DanmakuItem = { key, text: c.text, color: c.color || '#fff', mode, time: c.time, duration, lane, width: w };
      rtlLast[lane] = item;
      items.push(item);
      // コメントは時刻の順で、流れる時間はどれも同じなので、終わる時刻も順に並ぶ（並べ直さない）
      alive.push(c.time + duration);
      return;
    }
    const free = mode === 'top' ? topFree : bottomFree;
    const lane = free.findIndex((f) => f <= c.time);
    if (lane < 0) return;
    free[lane] = c.time + 4;
    items.push({ key, text: c.text, color: c.color || '#fff', mode, time: c.time, duration: 4, lane, width: w });
  });
  return { width, height, fontSize, lineHeight, speed, items };
}

/** t 秒の時に画面に出ているもの（時刻順に並んでいる items から二分探索で探す） */
export function visibleDanmaku(layout: DanmakuLayout, t: number): DanmakuItem[] {
  const items = layout.items;
  const maxDur = layout.width / layout.speed;
  let lo = 0;
  let hi = items.length;
  // t - 最長の表示時間 より後に出始めたものだけを見る
  const from = t - Math.max(maxDur, 4);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.time < from) lo = mid + 1; else hi = mid;
  }
  const out: DanmakuItem[] = [];
  for (let i = lo; i < items.length && items[i]!.time <= t; i++) {
    const it = items[i]!;
    if (t < it.time + it.duration) out.push(it);
  }
  return out;
}

/** 流れるコメントの左端の位置(px)。t は今の再生位置 */
export const danmakuX = (layout: DanmakuLayout, it: DanmakuItem, t: number) =>
  it.mode === 'rtl'
    ? layout.width - ((layout.width + it.width) * (t - it.time)) / it.duration
    : (layout.width - it.width) / 2;

/** 段の上端(px)。top は上から、bottom は下から数える */
export const danmakuTop = (layout: DanmakuLayout, it: DanmakuItem) =>
  it.mode === 'bottom' ? layout.height - (it.lane + 1) * layout.lineHeight : it.lane * layout.lineHeight;
