import { describe, expect, it } from 'vitest';

import {
  actionsToAnalyze, addTitleAnalyze, assignGroup, baseActionsForNewTitle, deleteEntryAnalyze, editAnalyze, findPatternsByString, freeGroups,
  initSegs, matchedPatterns, matchPattern2, newPatternAnalyze, rawToAction, removeGroup, segPattern, segmentsFromPattern, segmentsFromPattern2, stripTitleType, missingGroupRefs, andConditionForSave,
  ACTION_SCHEMA, withAddonActions, type ActionDef, type Analyzer,
} from '../src';

describe('アクションの形の行き来', () => {
  // アドオンが名乗る「文字を取ってくる」アクション（サーバーの /api/patterns/actives が返す形）
  const fetchDef: ActionDef = {
    key: 'getFromExample', label: '副題取得', description: '', output_type: 'depends_on_nested_analyze',
    addon: 'example_subtitle', fetch_text: true, searchable: true,
    params: [
      { key: 'sid', label: 'SID', type: 'context_ref', required: false, default: '$sid' },
      { key: 'startTimeField', label: '放送日時', type: 'context_ref', required: false, default: '$start_time' },
      { key: 'textField', label: '照合タイトル', type: 'template_string', required: false, default: '$title' },
      { key: 'pattern', label: '副題パターン', type: 'template_string', required: false },
      { key: 'analyze', label: 'ネスト', type: 'array<analyze>', required: false, default: [] },
    ],
  };
  const schema = withAddonActions(ACTION_SCHEMA, [fetchDef]);
  it('アドオンの文字を取ってくるアクションは pattern より前に足す', () => {
    const keys = schema.map((a) => a.key);
    expect(keys.indexOf('getFromExample')).toBeLessThan(keys.indexOf('pattern'));
    expect(withAddonActions(ACTION_SCHEMA, [{ ...fetchDef, addon: undefined }])).toEqual(ACTION_SCHEMA);
  });
  it('サーバーの形 → 編集の形 → サーバーの形', () => {
    const raw = [{ setStr: 'title', str: '{$1}' }, { getFromExample: '$title', sid: '$sid', textField: '{$1}', pattern: '第{$5}話', analyze: [{ setNum: 'episode_number', str: '{$5}' }] }];
    const acts = raw.map((r) => rawToAction(r, schema)!);
    expect(acts[0]).toEqual({ type: 'setStr', field: 'title', str: '{$1}' });
    // 文字を取ってくるアクションは pattern アクションに化けない
    expect(acts[1]!.type).toBe('getFromExample');
    expect(acts[1]!.analyze).toEqual([{ type: 'setNum', field: 'episode_number', str: '{$5}' }]);
    const back = actionsToAnalyze(acts, schema);
    expect(back[0]).toEqual({ setStr: 'title', str: '{$1}' });
    expect(back[1]).toMatchObject({ getFromExample: '$title', sid: '$sid', startTimeField: '$start_time', textField: '{$1}', pattern: '第{$5}話' });
  });
  it('空のスキーマでも消さない', () => {
    expect(rawToAction({ addList: 'category', str: 'x' }, [])).toEqual({ type: 'addList', field: 'category', str: 'x' });
  });
});

describe('区切り', () => {
  it('範囲を {$N} にし、外すと地の文字に戻る', () => {
    const s = assignGroup(initSegs('魔女 #3'), 4, 5, 2);
    expect(segPattern(s)).toBe('魔女 #{$2}');
    const t = assignGroup(s, 0, 2, 1);
    expect(segPattern(t)).toBe('{$1} #{$2}');
    expect(segPattern(removeGroup(t, 0))).toBe('魔女 #{$2}');
    expect(removeGroup(t, 0).length).toBe(2);
  });
  it('使っていない番号から4つ', () => expect(freeGroups(new Set([1, 3]))).toEqual([2, 4, 5, 6]));
  it('登録済みのパターンを当てる', () => {
    expect(segPattern(segmentsFromPattern('魔女 #3「森」', '{$1} #{$2}「{$3}」')!)).toBe('{$1} #{$2}「{$3}」');
    expect(segmentsFromPattern('別の番組', '{$1} #{$2}')).toBeNull();
    expect(segPattern(segmentsFromPattern2('第3話 森へ行く', '第{$5}話 [x]{$6}')!)).toBe('第{$5}話 {$6}');
  });
});

describe('照合', () => {
  const a: Analyzer = { pattern: '{$1} #{$2}', analyze: [{ switch: '{$1}', list: [{ str: '魔女', analyze: [{ setStr: 'title', str: '{$1}' }] }] }], pattern_index: 0 };
  it('switch に未登録の値は追加候補', () => {
    expect(findPatternsByString('猫 #3', [a], {})).toEqual([{ analyzer: a, groups: { g1: '猫', g2: '3' }, newValue: '猫' }]);
    expect(findPatternsByString('魔女 #3', [a], {})).toEqual([]);
  });
  it('AND条件は途中一致', () => {
    expect(matchPattern2({ ...a, pattern2: '第{$3}話', text2: '$description' }, { description: 'あ 第3話 い' })).toBe(true);
    expect(matchPattern2({ ...a, pattern2: '第{$3}話', text2: '$description' }, { description: '' })).toBe(false);
  });
  it('サーバーの照合結果に解析結果を付ける', () => {
    const r = matchedPatterns([a], { matches: [{ index: 0, match_type: 'list', matched_str: '魔女', groups: { g1: '魔女', g2: '3' } }], adopted_index: 0 });
    expect(r[0]).toMatchObject({ matchType: 'list', adopted: true, parseResult: { title: '魔女' } });
  });
});

describe('登録・編集の組み立て', () => {
  const a: Analyzer = { pattern: '{$1} #{$2}', analyze: [{ switch: '{$1}', list: [{ str: '魔女', analyze: [] }], else: [{ setStr: 'title', str: '{$1}' }] }] };
  const acts = [{ type: 'setStr', field: 'folder', str: '{$1}' }];
  it('新規は else かタイトル1件', () => {
    expect(newPatternAnalyze('else', '1', '', acts, ACTION_SCHEMA)).toEqual([{ switch: '{$1}', list: [], else: [{ setStr: 'folder', str: '{$1}' }] }]);
    expect(newPatternAnalyze('title', '1', ' 猫 ', acts, ACTION_SCHEMA)[0]!.list).toEqual([{ str: '猫', analyze: [{ setStr: 'folder', str: '{$1}' }] }]);
  });
  it('タイトルを足す・差し替える', () => {
    expect(addTitleAnalyze(a, '猫', acts, ACTION_SCHEMA)[0]!.list!.map((l) => l.str)).toEqual(['魔女', '猫']);
    expect(editAnalyze(a, { title: '魔女' }, acts, ACTION_SCHEMA)[0]!.list![0]!.analyze).toEqual([{ setStr: 'folder', str: '{$1}' }]);
    expect(editAnalyze(a, { else: true }, acts, ACTION_SCHEMA)[0]!.else).toEqual([{ setStr: 'folder', str: '{$1}' }]);
  });
  it('消して空になればパターンごと', () => {
    expect(deleteEntryAnalyze(a, { else: true }).empty).toBe(false);
    const noElse = { ...a, analyze: deleteEntryAnalyze(a, { else: true }).analyze };
    expect(deleteEntryAnalyze(noElse, { title: '魔女' }).empty).toBe(true);
  });
  it('タイトル別エントリの初めは else を写し、出力パスを足す', () => {
    expect(baseActionsForNewTitle(a, ACTION_SCHEMA, '/out')).toEqual([{ type: 'setStr', field: 'title', str: '{$1}' }, { type: 'setPath', field: 'app_output_path', str: '/out' }]);
  });
});

it('種別表記を外す', () => {
  expect(stripTitleType('見習い魔女の旅 (アニメ)')).toBe('見習い魔女の旅');
  expect(stripTitleType('ペガサス (2020年のテレビドラマ)')).toBe('ペガサス');
  expect(stripTitleType(null)).toBe('');
});

describe('パターン画面の保存前の確かめ', () => {
  it('パターンに無いグループの参照を見つける（入れ子は内側のグループで見る）', () => {
    expect(missingGroupRefs([{ setNum: 'episode_number', str: '{$2}' }], '{$1} #{$3}')).toEqual([['{$1} #{$3}', ['2']]]);
    expect(missingGroupRefs([{ getFromExample: '$title', textField: '{$1}', pattern: '第{$5}話', analyze: [{ setNum: 'e', str: '{$5}' }] }], '{$1}')).toEqual([]);
    expect(missingGroupRefs([{ getFromExample: '$title', textField: '{$9}', pattern: '第{$5}話', analyze: [{ setNum: 'e', str: '{$6}' }] }], '{$1}'))
      .toEqual([['{$1}', ['9']], ['第{$5}話', ['6']]]);
  });
  it('AND条件を組めない時は元を引き継ぐ', () => {
    const a = { pattern: '{$1}', pattern2: '第{$3}話', text2: '$description' };
    expect(andConditionForSave(a, true, '本文まるごと', '$description')).toEqual({ pattern2: '第{$3}話', text2: '$description' });
    expect(andConditionForSave(a, true, '第{$4}話', '$description')).toEqual({ pattern2: '第{$4}話', text2: '$description' });
    expect(andConditionForSave({ pattern: '{$1}' }, false, '', '$description')).toEqual({});
  });
  it('[] を落とさずに AND条件を当てる', () => {
    expect(segmentsFromPattern2('[字]第3話 森', '[字]第{$5}話 {$6}', false)!.map((x) => x.group)).toEqual([null, 5, null, 6]);
  });
});
