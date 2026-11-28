import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTO_ENCODE_FLAGS, autoEncodeBody, ruleTargets, summarizeRule, type AutoEncodeRule } from '../src';

const rule = (p: Partial<AutoEncodeRule>): AutoEncodeRule => ({
  id: 1, enabled: 1, folder: 'F', title: 'T', sid: 211, use_folder: 0, use_title: 1, use_sid: 1,
  require_episode_name: 0, require_episode_number: 1, allow_multi_episode: 0, ...p,
});

describe('ruleTargets', () => {
  it('使う条件がすべて合えば登録済み（複数話の並びは , でつないで比べる）', () => {
    expect(ruleTargets(rule({}), { title: ['T'] }, 211)).toBe(true);
    expect(ruleTargets(rule({}), { title: 'T' }, '211')).toBe(true);
    expect(ruleTargets(rule({}), { title: 'X' }, 211)).toBe(false);
    expect(ruleTargets(rule({ use_folder: 1, title: 'A, B' }), { folder: 'F', title: ['A', 'B'] }, 211)).toBe(true);
  });
  it('一致の条件が1つも無いルールは当たらない', () => {
    expect(ruleTargets(rule({ use_title: 0, use_sid: 0 }), { title: 'T' }, 211)).toBe(false);
  });
});

describe('summarizeRule / autoEncodeBody', () => {
  it('まとめ', () => {
    expect(summarizeRule(rule({ allow_multi_episode: 1 }))).toEqual(['title一致', 'sid一致', 'ep_num必須', '複数話可']);
  });
  it('録画は番号だけ、予約は確定値を書いて渡す', () => {
    expect(autoEncodeBody(6636, { title: 'T' }, 211, DEFAULT_AUTO_ENCODE_FLAGS)).toEqual({ recording_id: 6636, ...DEFAULT_AUTO_ENCODE_FLAGS });
    expect(autoEncodeBody(null, { title: ['T'], folder: '' }, 211, DEFAULT_AUTO_ENCODE_FLAGS)).toMatchObject({ title: 'T', folder: null, sid: 211 });
  });
});
