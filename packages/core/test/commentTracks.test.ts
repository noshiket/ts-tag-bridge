import { describe, expect, it } from 'vitest';

import { commentTrackLabel, commentTrackNames, normalizeCommentPayload, selectCommentTrack, type Comment } from '../src';

const cm = (time: number, text: string): Comment => ({ time, text, color: '', type: 'right', author: '', date: '' });

describe('コメントのトラック（外から取り込んだ実況）', () => {
  const p = normalizeCommentPayload({ comments: [cm(1, 'a'), cm(5, 'c')], tracks: { 取り込み: [cm(3, 'b')], 壊れ: 'x' } });

  it('追加のトラックを残し、一覧でない物は捨てる', () => {
    expect(Object.keys(p.tracks ?? {})).toEqual(['取り込み']);
  });
  it('全ては主と追加を時刻順にまとめる（既定）', () => {
    expect(selectCommentTrack(p, '*').map((c) => c.text)).toEqual(['a', 'b', 'c']);
  });
  it('標準は主のトラックだけ、名前を選ぶとそのトラックだけ', () => {
    expect(selectCommentTrack(p, 'comments').map((c) => c.text)).toEqual(['a', 'c']);
    expect(selectCommentTrack(p, '取り込み').map((c) => c.text)).toEqual(['b']);
    expect(selectCommentTrack(p, '無い名前').map((c) => c.text)).toEqual(['a', 'c']);
  });
  it('切り替えは追加のトラックがある時だけ出す', () => {
    expect(commentTrackNames(p)).toEqual(['*', 'comments', '取り込み']);
    expect(commentTrackNames(normalizeCommentPayload({ comments: [cm(1, 'a')] }))).toBeNull();
    expect(['*', 'comments', '取り込み'].map(commentTrackLabel)).toEqual(['全て', '標準', '取り込み']);
  });
  it('古い保存（配列そのもの）や壊れた答えも読める', () => {
    expect(normalizeCommentPayload([cm(1, 'a')])).toEqual({ comments: [cm(1, 'a')] });
    expect(normalizeCommentPayload(null)).toEqual({ comments: [] });
  });
});
