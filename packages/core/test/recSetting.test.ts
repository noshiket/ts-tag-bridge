import { describe, expect, it } from 'vitest';

import { applyRecPreset, initRecSetting, recSettingPayload, recSettingSummary } from '../src';

const raw = {
  recMode: 1, priority: 1, tuijyuuFlag: true, pittariFlag: false, serviceMode: 0, startMargin: 10, endMargin: 0,
  recFolderList: [{ recFolder: '!Default', recNamePlugIn: 'RecName_Macro.so?$Title$.ts', writePlugIn: 'Write_Default.so' }],
  batFilePath: '/x.sh*tag',
};

describe('initRecSetting', () => {
  it('EDCB の値を平たくする（マージン個別・サービス変換・ファイル名の引数・BAT のタグ）', () => {
    const v = initRecSetting(raw);
    expect(v).toMatchObject({ useDefMargin: 0, startMargin: 10, serviceMode: 1, recNamePlugIn: 'RecName_Macro.so', recName: '$Title$.ts', batFilePath: '/x.sh', batFileTag: 'tag', tuijyuuFlag: true });
  });
  it('recNameOp があればそちら、何も無ければ既定', () => {
    expect(initRecSetting({ recFolderList: [{ recNameOp: 'op', recNamePlugIn: 'p?arg' }] }).recName).toBe('op');
    expect(initRecSetting(null)).toMatchObject({ recMode: 1, priority: 2, useDefMargin: 1, serviceMode: 0, recFolder: '' });
  });
});

describe('recSettingPayload', () => {
  it('既定のマージンならマージンを送らない、空の文字の項目も送らない', () => {
    const p = recSettingPayload({ ...initRecSetting(null), recFolder: 'X' });
    expect(p).toMatchObject({ rec_mode: 1, use_def_margin: 1, rec_folder: 'X' });
    expect('start_margin' in p || 'bat_file_path' in p || 'preset_id' in p).toBe(false);
    expect(recSettingPayload(initRecSetting(raw))).toMatchObject({ start_margin: 10, end_margin: 0, bat_file_tag: 'tag', rec_name: '$Title$.ts' });
  });
});

describe('applyRecPreset', () => {
  const opts = { presets: [{ value: 'p1', label: 'P', rec_setting: { priority: 4 } }] };
  it('選ぶと全項目へ、解除で今の保存値へ。他の項目は残す', () => {
    const v = { ...initRecSetting(raw), extra: 'keep' };
    expect(applyRecPreset(v, 'p1', opts)).toMatchObject({ priority: 4, recFolder: '', presetID: 'p1', extra: 'keep' });
    expect(applyRecPreset({ ...v, priority: 3 }, '', opts, initRecSetting(raw))).toMatchObject({ priority: 1, presetID: '' });
  });
  it('まとめ', () => {
    expect(recSettingSummary(initRecSetting(raw))).toEqual(['モード: 指定サービス', '優先度: 1', '追従: する', 'マージン: 前10s/後0s', 'フォルダ: !Default', 'BATあり']);
  });
});
