import { describe, expect, it } from 'vitest';

import { reserveHeadline, splitTitleMarks, type Reserve } from '../src';

const r = (title: string, confirmed: Record<string, unknown> | null = null) => ({ title, confirmed }) as Reserve;

describe('splitTitleMarks', () => {
  it('[字][再] を印に分ける', () => {
    expect(splitTitleMarks('星のかけら #3 [字][再]')).toEqual({ title: '星のかけら #3', marks: ['字', '再'] });
  });
  it('長い [ ] は印にしない', () => {
    expect(splitTitleMarks('[生放送] 夜の森')).toEqual({ title: '[生放送] 夜の森', marks: [] });
  });
});

describe('reserveHeadline', () => {
  it('確定値があれば作品名・話数・サブタイトル', () => {
    expect(reserveHeadline(r('星のかけら 第2期 #3「はじまりの朝」[字]', { title: ['星のかけら 第2期'], episode_number: ['3'], episode_name: ['はじまりの朝'] })))
      .toEqual({ title: '星のかけら 第2期', episode: '3', sub: 'はじまりの朝', marks: ['字'] });
  });
  it('複数話はつなぐ', () => {
    expect(reserveHeadline(r('星のかけら', { episode_number: ['7', '8'] })).episode).toBe('7・8');
  });
  it('確定値が無ければ番組名から印を外したもの', () => {
    expect(reserveHeadline(r('夜の森[新]'))).toEqual({ title: '夜の森', episode: '', sub: '', marks: ['新'] });
  });
});
