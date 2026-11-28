import { describe, expect, it } from 'vitest';

import {
  LIST_SEP, applyAllTp, applyPresentTp, applyTpKey, confirmedSaveBody, editConfirmed, initConfirmedValues, normalizeAutoSend,
  resolveFields, switchEpisode,
} from '../src';

describe('initConfirmedValues', () => {
  it('並びは ␟ でつなぐ（副題の「, 」で分かれない）。JSON の文字列も読む。動画は並びがカテゴリだけ', () => {
    const v = initConfirmedValues({ episode_name: ['Hello, World', '次'], folder: '["A","B"]', category: ['x', 'y'], encode_dir: null }, 'recording');
    expect(v.episode_name).toBe(`Hello, World${LIST_SEP}次`);
    expect(v.folder).toBe(`A${LIST_SEP}B`);
    expect(v.encode_dir).toBe('');
    expect(initConfirmedValues({ episode_name: ['a', 'b'], category: ['x', 'y'] }, 'video')).toMatchObject({ episode_name: 'a, b', category: `x${LIST_SEP}y` });
  });
});

describe('解析結果の反映', () => {
  const tp = { title: 'T', episode_number: ['1', '2'], 't-episode_name': ['一', '二'], category: ['c'] };
  it('全項目: 無い項目は空、話数の並びは idx の話', () => {
    const v = applyAllTp({ folder: '古い', title: 'old' }, tp, 'video', 1);
    expect(v).toMatchObject({ title: 'T', episode_number: '2', episode_name: '二', category: 'c', folder: '' });
  });
  it('1項目 / 反映して保存（ある項目だけ上書き）', () => {
    expect(applyTpKey({ title: 'x' }, tp, 'title', 'rule').title).toBe('T');
    expect(applyPresentTp({ folder: 'そのまま' }, tp, 'rule')).toMatchObject({ folder: 'そのまま', episode_number: `1${LIST_SEP}2` });
  });
  it('話を変える', () => {
    expect(switchEpisode({}, tp, 0)).toMatchObject({ episode_number: '1', episode_name: '一' });
  });
  it('手で直すと「その他」は空に', () => {
    expect(editConfirmed({ else_info: 'x', title: 'a' }, 'title', 'b')).toEqual({ else_info: '', title: 'b' });
    expect(editConfirmed({ else_info: 'x' }, 'else_info', 'y').else_info).toBe('y');
  });
});

describe('confirmedSaveBody', () => {
  it('並びを配列に戻す（複数は空も残す、1つの空は null）・自動送信・ルールは encode_dir を送らない', () => {
    const b = confirmedSaveBody({ episode_number: `1${LIST_SEP}`, folder: '', title: 'T', auto_send: 'true', encode_dir: '/mnt' }, 'rule', { manual: true, parserError: null });
    expect(b).toMatchObject({ episode_number: ['1', ''], folder: null, title: 'T', auto_send: 3, is_text_parser: 0 });
    expect('encode_dir' in b).toBe(false);
    expect(confirmedSaveBody({ encode_dir: '/mnt' }, 'recording', { manual: false, parserError: ['e'] })).toMatchObject({ encode_dir: '/mnt', is_text_parser: 1, parser_error: ['e'] });
  });
  it('自動送信の値', () => {
    expect([normalizeAutoSend(''), normalizeAutoSend('false'), normalizeAutoSend('9'), normalizeAutoSend('x')]).toEqual(['', 0, 5, 0]);
  });
  it('パスの解決に渡す値', () => {
    expect(resolveFields({ title: `A${LIST_SEP}B`, setting: '' }, '[字]')).toMatchObject({ title: ['A', 'B'], setting: '[字]' });
  });
});
