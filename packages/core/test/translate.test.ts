import { describe, expect, it } from 'vitest';

import { formatMessage, translate } from '../src';

const JA = { 'a.hello': 'こんにちは', 'a.count': '{n}曲', 'a.only': '日本語だけ' };

describe('translate', () => {
  it('その言語の辞書を引き、無いキーは日本語で出す', () => {
    const en = { 'a.hello': 'Hello' };
    expect(translate(JA, en, 'a.hello')).toBe('Hello');
    expect(translate(JA, en, 'a.only')).toBe('日本語だけ');
    expect(translate(JA, null, 'a.hello')).toBe('こんにちは');
  });
  it('どこにも無いキーはキーのまま', () => {
    expect(translate(JA, {}, 'a.none')).toBe('a.none');
  });
  it('{n} を埋め、単数と複数を分ける', () => {
    const en = { 'a.count': { one: '{n} track', other: '{n} tracks' } };
    expect(translate(JA, en, 'a.count', { n: 1 })).toBe('1 track');
    expect(translate(JA, en, 'a.count', { n: 3 })).toBe('3 tracks');
    expect(translate(JA, null, 'a.count', { n: 3 })).toBe('3曲');
  });
  it('埋める値が無い {x} はそのまま', () => {
    expect(formatMessage('{a}-{b}', { a: 1 })).toBe('1-{b}');
  });
});
