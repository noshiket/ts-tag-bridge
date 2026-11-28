// 番組表の拡大縮小（元の Web 版の usePinchZoom と同じ決め方）。
// 番組の所をつまむと縦横とも（scale）、時刻の列をつまむと時間の軸だけ（vZoom）。つまんだ所は同じ位置に残す

/** 縮める下限: 全部の列が画面の幅に入る倍率（列が少なければ 0.4 まで）。読める下限は 0.15。広げる上限は 2 */
export function minScale(viewportW: number, rulerW: number, nCols: number, colBase: number): number {
  const fit = (viewportW - rulerW) / (Math.max(1, nCols) * colBase);
  return Math.max(0.15, Math.min(0.4, fit));
}
export const clampScale = (s: number, min: number) => Math.min(2, Math.max(min, s));
/** 時間の軸だけの拡大縮小は 0.5〜3 */
export const clampVZoom = (v: number) => Math.min(3, Math.max(0.5, v));

/** PC の −/＋（0.1 刻み。0.4〜2） */
export const stepScale = (s: number, dir: 1 | -1) =>
  dir > 0 ? Math.min(2, Math.round((s + 0.1) * 10) / 10) : Math.max(0.4, Math.round((s - 0.1) * 10) / 10);

/** つまみ始めた所（中身の上の、何時間目・何列目か） */
export interface PinchAnchor { hours: number; cols: number; focalX: number; focalY: number }

/** つまみ始め: 指の真ん中（番組の所の左上からの位置）と今のスクロールから、中身のどこかを覚える */
export function pinchAnchor(focalX: number, focalY: number, scrollX: number, scrollY: number, pxPerHour: number, colWidth: number): PinchAnchor {
  return { hours: Math.max(0, focalY + scrollY) / pxPerHour, cols: Math.max(0, focalX + scrollX) / colWidth, focalX, focalY };
}

/** 大きさが変わった後、覚えた所が指の真ん中に残るスクロールの位置 */
export function anchoredScroll(a: PinchAnchor, pxPerHour: number, colWidth: number) {
  return { x: Math.max(0, a.cols * colWidth - a.focalX), y: Math.max(0, a.hours * pxPerHour - a.focalY) };
}
