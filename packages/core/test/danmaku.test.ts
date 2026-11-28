import { describe, expect, it } from 'vitest';

import { danmakuX, estimateTextWidth, layoutDanmaku, visibleDanmaku, type Comment } from '../src';

const c = (time: number, text = 'あいう', type = 'right'): Comment => ({ time, text, type, color: '#fff', author: '', date: '' });

describe('実況を流す配置', () => {
  it('文字の大きさは幅に比例し、全角は半角より広く見積もる', () => {
    const big = layoutDanmaku([], 1024, 576);
    expect(big.fontSize).toBeCloseTo(42.5);
    expect(estimateTextWidth('あa', 10)).toBeCloseTo(15.5);
  });

  it('同時に出たものは別の段へ。前が出きった後なら同じ段を使える', () => {
    const l = layoutDanmaku([c(0), c(0), c(10)], 1024, 576);
    expect(l.items.map((i) => i.lane)).toEqual([0, 1, 0]);
  });

  it('同時に出る数の上限を超えた分は流さない（固定のコメントは数えない）', () => {
    const many = Array.from({ length: 10 }, (_, i) => c(i * 0.01));
    const l = layoutDanmaku([...many, c(0.2, 'x', 'top')], 1024, 2000, { maxOnScreen: 3 });
    expect(l.items.filter((i) => i.mode === 'rtl')).toHaveLength(3);
    expect(l.items.filter((i) => i.mode === 'top')).toHaveLength(1);
  });

  it('右端から左へ流れ、表示の時間が過ぎたら消える', () => {
    const l = layoutDanmaku([c(5)], 1024, 576);
    const it0 = l.items[0]!;
    expect(danmakuX(l, it0, 5)).toBe(1024);
    expect(danmakuX(l, it0, 5 + it0.duration)).toBeCloseTo(-it0.width);
    expect(visibleDanmaku(l, 4.9)).toHaveLength(0);
    expect(visibleDanmaku(l, 6)).toHaveLength(1);
    expect(visibleDanmaku(l, 5 + it0.duration + 0.1)).toHaveLength(0);
  });
});
