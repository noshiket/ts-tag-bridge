import { describe, expect, it } from 'vitest';

import { applyAnalyze, choosePreview, mockParse, patternToRegex, withAddedTitle, type Pattern } from '../src';

describe('patternToRegex', () => {
  it('最後の {$n} だけ貪欲、記号は文字どおり', () => {
    const m = '南天の剣 剣王軍 #17'.match(patternToRegex('{$1} #{$2}'));
    expect(m?.slice(1)).toEqual(['南天の剣 剣王軍', '17']);
    expect('A(1)'.match(patternToRegex('A({$1})'))?.[1]).toBe('1');
  });
});

describe('applyAnalyze', () => {
  it('setStr / setNum / addList / SID から引く印', () => {
    const r = applyAnalyze([
      { setStr: 'title', str: '{$1}' }, { setNum: 'episode_number', str: '{$2}' },
      { addList: 'category', str: '{$title}' }, { addList: 'category' }, { getFromSid: 1 },
    ], { g1: 'ポコロ', g2: '06' });
    expect(r).toEqual({ title: 'ポコロ', episode_number: 6, category: ['ポコロ', ''], _sid_lookup: true });
  });
});

describe('mockParse', () => {
  const pats: Pattern[] = [
    { pattern: '{$1} #{$2}', analyze: [{ switch: '{$1}', list: [{ str: 'ポコロ', analyze: [{ setStr: 'title', str: '{$1}' }] }] }] },
  ];
  it('switch に登録済みなら結果、未登録なら未登録、構造が合わなければマッチなし', () => {
    expect(mockParse('ポコロ #6', pats)).toMatchObject({ status: 'matched', result: { title: 'ポコロ' }, groups: { g1: 'ポコロ', g2: '6' } });
    expect(mockParse('ガイア #6', pats)).toMatchObject({ status: 'unregistered', newValue: 'ガイア' });
    expect(mockParse('ガイア', pats)).toEqual({ status: 'nomatch' });
  });
  it('「パターンに追加」した見本では採用される', () => {
    const next = withAddedTitle(pats, '{$1} #{$2}', 'ガイア', { title: 'ガイア', folder: 'G', type: '' });
    expect(mockParse('ガイア #6', next)).toMatchObject({ status: 'matched', result: { title: 'ガイア', folder: 'G', episode: 6 } });
  });
});

describe('choosePreview', () => {
  const unregistered = { status: 'unregistered' as const, pattern: '{$1} {$3} #{$2}', groups: {}, newValue: '南天の剣' };
  it('サーバーで採用されたものを先に出す（簡易版の未登録より先。元の 南天の剣 の件）', () => {
    const p = choosePreview('南天の剣 剣王軍 #17', { status: 'matched', matched_pattern: '{$1} #{$2}', result: { title: '南天の剣' } }, unregistered);
    expect(p).toEqual({ status: 'matched', pattern: '{$1} #{$2}', result: { title: '南天の剣' }, groups: { g1: '南天の剣 剣王軍', g2: '17' } });
  });
  it('採用が無ければ登録の手伝い、それも無ければマッチなし、サーバーに届かなければ簡易版', () => {
    expect(choosePreview('x', { status: 'nomatch' }, unregistered)).toBe(unregistered);
    expect(choosePreview('x', { status: 'nomatch' }, { status: 'nomatch' })).toEqual({ status: 'nomatch' });
    const mock = { status: 'matched' as const, pattern: 'p', groups: {}, result: {} };
    expect(choosePreview('x', null, mock)).toBe(mock);
  });
});
