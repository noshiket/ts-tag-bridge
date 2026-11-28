import { describe, expect, it } from 'vitest';

import {
  ARIB_GENRES, DEFAULT_SEARCH_QUERY, expandedGenres, futureResults, inputHistoryCandidates, largeGenreSelection, normalizeContentList,
  parseInputHistory, parseSearchQuery, pushInputHistory, searchGenreLabel, searchParams, searchTimes, toggleLargeGenre, type EpgEvent,
} from '../src';

const drama = ARIB_GENRES.find((g) => g.n1 === 3)!; // 国内・海外・時代劇・その他
const other = ARIB_GENRES.find((g) => g.n1 === 15)!; // 中ジャンル無し

describe('番組検索の条件', () => {
  it('大ジャンルを押すと中ジャンルを全部入れる・どれかあれば全部外す', () => {
    const all = toggleLargeGenre([], drama);
    expect(all).toEqual([768, 769, 770, 783]);
    expect(largeGenreSelection(all, drama)).toEqual({ count: 4, all: true, any: true });
    expect(largeGenreSelection([769], drama)).toEqual({ count: 1, all: false, any: true });
    expect(toggleLargeGenre([769, 1], drama)).toEqual([1]);
    expect(toggleLargeGenre([], other)).toEqual([4095]);
    expect(toggleLargeGenre([4095], other)).toEqual([]);
    expect(expandedGenres([769]).map((g) => g.n1)).toEqual([3]);
  });
  it('中ジャンルが全部なら大ジャンルの値にまとめて送る', () => {
    expect(normalizeContentList([768, 769, 770, 783, 256])).toEqual([256, 1023]);
    expect(normalizeContentList([768])).toEqual([768]);
  });
  it('送る問い合わせ: 指定の無い項目は送らない', () => {
    expect(searchParams(DEFAULT_SEARCH_QUERY)).toBe('days=7');
    const q = searchParams({
      ...DEFAULT_SEARCH_QUERY, andkey: 'QZX AI', notkey: '再', regExp: true, titleOnly: true, aimai: true, archive: true,
      freeCaFlag: 1, durationMin: 30, durationMax: 60, days: 0, serviceList: ['32736-32736-1024', '4-16625-211'], contentList: [768], notContent: true,
    });
    expect(q).toBe('and_key=QZX+AI&not_key=%E5%86%8D&reg_exp_flag=1&title_only_flag=1&aimai_flag=1&archive=1&free_ca_flag=1'
      + '&chk_duration_min=30&chk_duration_max=60&service=32736-32736-1024&service=4-16625-211&content=768&not_content_flag=1');
  });
  it('残した条件を読む（足りない所は既定・壊れていたら既定）', () => {
    expect(parseSearchQuery('{"andkey":"x"}')).toEqual({ ...DEFAULT_SEARCH_QUERY, andkey: 'x' });
    expect(parseSearchQuery('{')).toEqual(DEFAULT_SEARCH_QUERY);
    expect(parseSearchQuery(null)).toEqual(DEFAULT_SEARCH_QUERY);
  });
});

describe('番組検索の結果', () => {
  const ev = (start: string, sec: number) => ({ start_time: start, duration_sec: sec }) as EpgEvent;
  it('時刻の表し方', () => {
    const t = searchTimes(ev('2026-11-08T23:30:00+09:00', 5400));
    expect([t.list, t.sheet]).toEqual(['11-08 23:30 · 90分', '11-08 23:30 — 01:00 (90分)']);
  });
  it('「現在以降」は終わっていない番組', () => {
    const now = Date.parse('2026-11-08T12:00:00+09:00');
    const rs = [ev('2026-11-08T11:00:00+09:00', 3600), ev('2026-11-08T11:30:00+09:00', 3600)];
    expect(futureResults(rs, now)).toEqual([rs[1]]);
  });
  it('ジャンルの名前', () => {
    expect([searchGenreLabel(0x0702), searchGenreLabel(0xf0f), searchGenreLabel(null), searchGenreLabel(0xc00)]).toEqual(['アニメ/特撮', 'その他', '', '']);
  });
});

describe('入力欄の履歴', () => {
  it('同じものは先頭へ・短いものは残さない・20まで', () => {
    expect(pushInputHistory(['a1', 'b2'], ' b2 ')).toEqual(['b2', 'a1']);
    const l = ['x1'];
    expect(pushInputHistory(l, 'y')).toBe(l);
    expect(pushInputHistory(Array.from({ length: 20 }, (_, i) => `v${i}`), 'new')).toHaveLength(20);
  });
  it('候補は打っている文字を含むもの（今の値は除く）', () => {
    expect(inputHistoryCandidates(['特集スペシャル', 'toku news', 'アニメ'], 'toku')).toEqual(['toku news']);
    expect(inputHistoryCandidates(['abc', 'abcd'], 'abc')).toEqual(['abcd']);
    expect(parseInputHistory('["a",1,"b"]')).toEqual(['a', 'b']);
    expect(parseInputHistory('x')).toEqual([]);
  });
});
