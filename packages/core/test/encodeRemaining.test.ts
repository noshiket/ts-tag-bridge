import { describe, expect, it } from 'vitest';

import { encodeRemainingSec } from '../src';

const START = '2026-11-24T05:00:00+09:00';
const at = (min: number) => Date.parse(START) + min * 60_000;

describe('encodeRemainingSec', () => {
  it('その1本の進み方から残りを出す（10分で 25% → 残り 30 分）', () => {
    expect(encodeRemainingSec({ state: 'encoding', progress: 0.25, encodingStartedAt: START }, at(10))).toBe(1800);
  });
  it('始めの 2 分はぶれるので出さない', () => {
    expect(encodeRemainingSec({ state: 'encoding', progress: 0.25, encodingStartedAt: START }, at(1))).toBeNull();
  });
  it('3% 未満は出さない', () => {
    expect(encodeRemainingSec({ state: 'encoding', progress: 0.02, encodingStartedAt: START }, at(10))).toBeNull();
  });
  it('始めた時刻が無い・エンコード中でなければ出さない', () => {
    expect(encodeRemainingSec({ state: 'encoding', progress: 0.5, encodingStartedAt: '' }, at(10))).toBeNull();
    expect(encodeRemainingSec({ state: 'split_ts', progress: 0.5, encodingStartedAt: START }, at(10))).toBeNull();
  });
});
