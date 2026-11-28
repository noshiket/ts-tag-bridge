import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MUTE_SETTINGS, isMutedComment, normalizeCommentKeyword, parseMuteSettings, unmutedComments, type MuteSettings,
} from '../src/stream/commentMute';

const on = (patch: Partial<MuteSettings>): MuteSettings => ({ ...DEFAULT_MUTE_SETTINGS, ...patch });
const c = (text: string, extra: Partial<{ color: string; position: string; size: string }> = {}) =>
  ({ text, color: '#FFFFFF', position: 'right', ...extra });

describe('normalizeCommentKeyword', () => {
  it('全角英数・全角空白・長音の仲間をそろえ、英字は小文字にする', () => {
    expect(normalizeCommentKeyword('ＡＢＣ１２３　ｷﾀ━ー〜')).toBe('abc123 キタ---');
  });
});

describe('isMutedComment', () => {
  it('既定では迷惑な統計コメントだけ弾く', () => {
    expect(isMutedComment(DEFAULT_MUTE_SETTINGS, c('いつもの'))).toBe(false);
    expect(isMutedComment(DEFAULT_MUTE_SETTINGS, c('最高30米/秒'))).toBe(true);
  });

  it('色付き: 録画の白(#FFFFFF)もライブの白(#FFEAEA)も色なしとみなす', () => {
    const s = on({ mute_colored_comments: true });
    expect(isMutedComment(s, c('a', { color: '#ffffff' }))).toBe(false);
    expect(isMutedComment(s, c('a', { color: '#FFEAEA' }))).toBe(false);
    expect(isMutedComment(s, c('a', { color: '#FFC000' }))).toBe(true);
  });

  it('上下固定・大きいコメント・同じ文字の 8 回以上の連続', () => {
    expect(isMutedComment(on({ mute_fixed_comments: true }), c('a', { position: 'top' }))).toBe(true);
    expect(isMutedComment(on({ mute_fixed_comments: true }), c('a'))).toBe(false);
    expect(isMutedComment(on({ mute_big_size_comments: true }), c('a', { size: 'big' }))).toBe(true);
    expect(isMutedComment(on({ mute_consecutive_same_characters_comments: true }), c('wwwwwwww'))).toBe(true);
    expect(isMutedComment(on({ mute_consecutive_same_characters_comments: true }), c('wwwwwww'))).toBe(false);
  });

  it('露骨な表現・差別的な表現の正規表現が読めて効く', () => {
    expect(isMutedComment(on({ mute_vulgar_comments: true }), c('SEX'))).toBe(true);
    expect(isMutedComment(on({ mute_vulgar_comments: true }), c('いつもの'))).toBe(false);
    expect(isMutedComment(on({ mute_abusive_discriminatory_prejudiced_comments: true }), c('キモい'))).toBe(true);
  });

  it('キーワード: 部分・前方・後方・完全・正規表現。そろえてから比べる', () => {
    const kw = (match: MuteSettings['muted_comment_keywords'][number]['match'], pattern: string) =>
      on({ muted_comment_keywords: [{ match, pattern }] });
    expect(isMutedComment(kw('partial', 'ポコ'), c('ポコポコ'))).toBe(true);
    expect(isMutedComment(kw('forward', 'あの'), c('あのあの'))).toBe(true);
    expect(isMutedComment(kw('forward', 'の'), c('あの'))).toBe(false);
    expect(isMutedComment(kw('backward', 'の'), c('あの'))).toBe(true);
    expect(isMutedComment(kw('exact', 'あの'), c('あのあの'))).toBe(false);
    expect(isMutedComment(kw('regex', '^\\d+$'), c('623'))).toBe(true);
    // 全角・大文字でも当たる（そろえる設定が既定で入）
    expect(isMutedComment(kw('partial', 'abc'), c('ＡＢＣです'))).toBe(true);
    expect(isMutedComment(on({ muted_comment_keywords: [{ match: 'partial', pattern: 'abc' }],
      mute_comment_keywords_normalize_alphanumeric_width_case: false }), c('ＡＢＣです'))).toBe(false);
  });
});

describe('parseMuteSettings / unmutedComments', () => {
  it('壊れた保存は既定、足りない項目は既定で埋める', () => {
    expect(parseMuteSettings('{')).toEqual(DEFAULT_MUTE_SETTINGS);
    expect(parseMuteSettings('{"comment_opacity":0.8}').comment_opacity).toBe(0.8);
    expect(parseMuteSettings('{"comment_opacity":0.8}').comment_max_onscreen).toBe(100);
  });

  it('弾幕に流すものだけ残す', () => {
    const list = [
      { time: 1, text: 'a', color: '#FFFFFF', type: 'right', author: '', date: '' },
      { time: 2, text: 'b', color: '#FFC000', type: 'right', author: '', date: '' },
    ];
    expect(unmutedComments(list, on({ mute_colored_comments: true })).map((x) => x.text)).toEqual(['a']);
  });
});
