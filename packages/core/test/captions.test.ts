import { describe, expect, it } from 'vitest';

import { buildScreenGroups, captionAt, captionSvg, type CaptionEntry } from '../src';
import { cloneDeep } from '../src/util/structuredClone';

const cap = (pts: number, text: string, clear = true): CaptionEntry => ({
  pts, duration_ms: null, clear_screen: clear,
  tokens: [
    ...(clear ? [{ tag: 'ClearScreen' }] : []),
    { tag: 'SetWritingFormat', format: 7 },
    { tag: 'SetDisplayFormat', horizontal: 620, vertical: 480 },
    { tag: 'SetDisplayPosition', horizontal: 170, vertical: 30 },
    { tag: 'CharacterCompositionDotDesignation', horizontal: 36, vertical: 36 },
    { tag: 'ActiveCoordinatePositionSet', x: 210, y: 359 },
    ...[...text].map((character) => ({ tag: 'Character', character, non_spacing: false })),
  ],
});

describe('字幕', () => {
  it('ClearScreen ごとに画面を分け、次の画面の頭で終わる', () => {
    const g = buildScreenGroups([cap(1, 'あ'), cap(2, 'い', false), cap(5, 'う')]);
    expect(g.map((x) => [x.start, x.end, x.captions.length])).toEqual([[1, 5, 2], [5, Infinity, 1]]);
    expect(captionAt(g, 0.5)).toBeNull();
    expect(captionAt(g, 1.5)).toEqual({ group: 0, count: 1 });
    expect(captionAt(g, 3)).toEqual({ group: 0, count: 2 });
  });

  it('SVG にする', () => {
    const g = buildScreenGroups([cap(1, '字幕<&>')]);
    const cache = new Map<string, string | null>();
    const svg = captionSvg(g, 1.2, cache);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('字');
    expect(svg).toContain('&lt;');
    expect(captionSvg(g, 1.3, cache)).toBe(svg);
    expect(captionSvg(g, 0.5, cache)).toBeNull();
  });

  it('structuredClone の代わり（iOS 用）で解析の状態を深く写せる', () => {
    const src = { a: [1, { b: 2 }], m: new Map([['k', { v: 1 }]]), buf: new Uint8Array([1, 2]).buffer, u: new Uint8Array([3]) };
    const c = cloneDeep(src) as typeof src;
    expect(c).toEqual(src);
    expect(c.a[1]).not.toBe(src.a[1]);
    expect(c.m.get('k')).not.toBe(src.m.get('k'));
    expect(new Uint8Array(c.buf)).toEqual(new Uint8Array([1, 2]));
    expect(c.u).toBeInstanceOf(Uint8Array);
  });
});
