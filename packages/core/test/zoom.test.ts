import { describe, expect, it } from 'vitest';

import { anchoredScroll, clampScale, clampVZoom, minScale, pinchAnchor, stepScale } from '../src';

describe('番組表の拡大縮小', () => {
  it('縮める下限: 全部の列が入る倍率（0.15〜0.4）', () => {
    expect(minScale(430, 38, 8, 144)).toBeCloseTo(392 / 1152);
    expect(minScale(1400, 38, 3, 144)).toBe(0.4);
    expect(minScale(430, 38, 60, 144)).toBe(0.15);
    expect([clampScale(3, 0.3), clampScale(0.1, 0.3), clampVZoom(5), clampVZoom(0.2)]).toEqual([2, 0.3, 3, 0.5]);
  });
  it('PC の −/＋ は 0.1 刻み', () => {
    expect([stepScale(1, 1), stepScale(1, -1), stepScale(0.4, -1), stepScale(2, 1)]).toEqual([1.1, 0.9, 0.4, 2]);
  });
  it('つまんだ所が指の真ん中に残る', () => {
    const a = pinchAnchor(100, 200, 300, 1000, 200, 144);
    expect(a).toMatchObject({ hours: 6, cols: 400 / 144 });
    // 2倍にすると、同じ所が同じ指の位置に来るスクロール
    expect(anchoredScroll(a, 400, 288)).toEqual({ x: 700, y: 2200 });
    expect(anchoredScroll(a, 200, 144)).toEqual({ x: 300, y: 1000 });
  });
});
