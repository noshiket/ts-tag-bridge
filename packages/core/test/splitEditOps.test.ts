import { describe, expect, it } from 'vitest';

import { addMuteRange, intervalCuts, resizedCuts, setChapNameAt, splitKeepAtTime } from '../src/split/editOps';

const segs = (cuts: number[], total: number) => [0, ...cuts].map((s, i) => ({ start: s, end: cuts[i] ?? total }));

describe('分割の編集の計算', () => {
  it('間隔を変えると、固定した話の長さを残して余りが差を吸う', () => {
    // 3話 + 余り（最後）。2話目を固定（20分のまま）
    const s = segs([1800, 3000, 4800], 6000);
    expect(intervalCuts(s, new Set([1]), 1500, 3, 6000)).toEqual([1500, 2700, 4200]);
    // 余りが無い時（remIdx=-1）は合計を超えない
    expect(intervalCuts(segs([3000], 6000), new Set(), 4000, -1, 6000)).toEqual([4000]);
  });
  it('1話の長さを変えると余りが差を吸い、余りの話そのものは変えない', () => {
    const s = segs([1800, 3600], 5000);
    expect(resizedCuts(s, 0, 1500, 'end', 5000)).toEqual([1500, 3300]);
    expect(resizedCuts(s, 2, 100, 'end', 5000)).toBeNull();
    expect(resizedCuts(s, 9, 100, 'end', 5000)).toBeNull();
  });
  it('採用区間は中に含む時だけ2つに割る', () => {
    const tl = { 0: [{ from: 10, to: 50 }] };
    expect(splitKeepAtTime(tl, 0, 30)[0]).toEqual([{ from: 10, to: 30 }, { from: 30, to: 50 }]);
    expect(splitKeepAtTime(tl, 0, 60)).toBe(tl);
    expect(splitKeepAtTime({}, 1, 5)).toEqual({});
  });
  it('無音区間は前後を入れ替えて時刻順、チャプター名は空で消す', () => {
    expect(addMuteRange({ 0: [{ from: 50, to: 60 }] }, 0, 20, 10)[0]).toEqual([{ from: 10, to: 20 }, { from: 50, to: 60 }]);
    const named = setChapNameAt({}, 0, 12.3456, 'A');
    expect(named).toEqual({ 0: { '12.346': 'A' } });
    expect(setChapNameAt(named, 0, 12.3456, '')).toEqual({ 0: {} });
  });
});
