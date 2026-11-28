import { describe, expect, it } from 'vitest';

import { adjacentInQueue, frameAt, frameTimes, nextRepeat, parseRepeat, shuffleIds, snapToFrame, sortPlaylists } from '../src';

describe('再生の並び', () => {
  it('隣の曲。端では止まり、全体の繰り返しなら回り込む', () => {
    expect([adjacentInQueue([1, 2, 3], 2, 1, 'off'), adjacentInQueue([1, 2, 3], 3, 1, 'off'), adjacentInQueue([1, 2, 3], 3, 1, 'all'), adjacentInQueue([1, 2, 3], 1, -1, 'all'), adjacentInQueue([1, 2, 3], 9, 1, 'all')])
      .toEqual([3, null, 1, 3, null]);
  });
  it('繰り返しの切り替えと、混ぜる（指定した曲を1曲目に）', () => {
    expect([nextRepeat('off'), nextRepeat('all'), nextRepeat('one'), parseRepeat('x'), parseRepeat('one')]).toEqual(['all', 'one', 'off', 'off', 'one']);
    const a = shuffleIds([1, 2, 3, 4, 5], 4, () => 0.5);
    expect(a[0]).toBe(4);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('プレイリストの並べ替え', () => {
    const p = (id: number, name: string, o: object = {}) => ({ id, name, kind: 'playlist', parent_id: null, item_count: 0, ...o });
    const l = [p(1, 'b', { updated_at: '2026-01-02', last_played_at: null }), p(2, 'a', { updated_at: '2026-01-03', last_played_at: '2026-02-01' }), p(3, 'c', { kind: 'folder', updated_at: '2026-01-01' })];
    expect(sortPlaylists(l, 'updated').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortPlaylists(l, 'title').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortPlaylists(l, 'played').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortPlaylists(l, 'kind').map((x) => x.id)).toEqual([3, 2, 1]);
  });
});

describe('チャプターの編集', () => {
  it('chapter_txt を読み、時刻を書く', async () => {
    const { chapterTime, parseChapterTxt } = await import('../src');
    const t = 'CHAPTER02=00:10:00.500\nCHAPTER02NAME=B\nCHAPTER01=00:00:00.000\nCHAPTER01NAME=A\nCHAPTER03=01:00:01.250';
    expect(parseChapterTxt(t)).toEqual([{ sec: 0, name: 'A' }, { sec: 600.5, name: 'B' }, { sec: 3601.25, name: '' }]);
    expect(parseChapterTxt(null)).toEqual([]);
    expect([chapterTime(3601.25), chapterTime(-3)]).toEqual(['01:00:01.250', '00:00:00.000']);
  });
});

describe('clipFrames', () => {
  const times = frameTimes(new Uint8Array([0, 0, 1, 0]), { deltas: [1001, 2002], timebase: 30000, first: 0 });
  it('各コマの時刻を積み上げる', () => {
    expect(Array.from(times).map((t) => Math.round(t * 30000))).toEqual([0, 1001, 2002, 4004, 5005]);
  });
  it('時刻を含むコマへ吸着する', () => {
    expect(frameAt(times, 0.05)).toBe(1);
    expect(frameAt(times, 2002 / 30000)).toBe(2);
    expect(snapToFrame(times, 0.1)).toBeCloseTo(2002 / 30000);
    expect(frameAt([], 1)).toBe(-1);
    expect(snapToFrame([], 1.5)).toBe(1.5);
  });
});

describe('再生するもの', () => {
  it('動画と録画で置き場所と視聴履歴の名前が分かれる', async () => {
    const { streamBase, targetKey, watchIdentity } = await import('../src');
    expect(streamBase(5)).toBe('/api/streams/vdb/5');
    expect(streamBase({ kind: 'video', id: 7 })).toBe('/api/streams/video/7');
    expect([targetKey(5), targetKey({ kind: 'video', id: 7 })]).toEqual([5, 'rec:7']);
    expect(watchIdentity({ kind: 'video', id: 7 }, 'n2')).toEqual({ type: 'recording', id: 'n2:7' });
    expect(watchIdentity(5)).toEqual({ type: 'video', id: '5' });
  });
});

describe('ロゴの範囲', () => {
  it('割合を元映像の偶数の画素へ直し、はみ出させない', async () => {
    const { logoRectToPixels } = await import('../src');
    expect(logoRectToPixels({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 1440, 1080)).toEqual({ x: 720, y: 540, width: 144, height: 108 });
    expect(logoRectToPixels({ x: 0.99, y: 0, w: 0.5, h: 0 }, 1440, 1080)).toEqual({ x: 1426, y: 0, width: 14, height: 2 });
  });
  it('角だけを動かし、対角と枠の外は守る', async () => {
    const { logoMoveCorner, logoNormalize, logoCornerAnchor } = await import('../src');
    const r = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const tl = logoMoveCorner(r, 'tl', -0.5, 0.05);
    expect(tl.x).toBe(0); expect(tl.x + tl.w).toBeCloseTo(0.3); expect(tl.y).toBeCloseTo(0.15);
    expect(logoMoveCorner(r, 'br', 2, -1)).toMatchObject({ w: 0.9, h: 0.005 });
    expect(logoNormalize({ x: 0.5, y: 0.2 }, { x: 0.1, y: 0.4 })).toMatchObject({ x: 0.1, y: 0.2 });
    expect(logoCornerAnchor(r, { x: 0.3, y: 0.3 }, { x: 0.02, y: 0.02 })).toEqual({ x: 0.1, y: 0.1 });
    expect(logoCornerAnchor(r, { x: 0.2, y: 0.2 }, { x: 0.02, y: 0.02 })).toBeNull();
  });
  it('黒帯を除いた映像の位置', async () => {
    const { containRect, logoProgress } = await import('../src');
    expect(containRect(400, 400, 16 / 9)).toEqual({ left: 0, top: 87.5, width: 400, height: 225 });
    expect(logoProgress(500, 1000)).toBe(50);
    expect(logoProgress(5000, 1000)).toBe(100);
  });
});
