import { describe, expect, it } from 'vitest';

import { effectiveInfo, fillAddonDefaults, fillAmzDefaults, selectEncoder, updateEffective, type AmzServer, type EncoderAddon } from '../src';

const servers: AmzServer[] = [
  { name: 'a', url: 'http://a:32769', encode_preset: [
    { name: 'cmcut', input_ts: 'cut.ts', mode: 'Test', outputs: { dstPath: 'out', profile: 'HEVC' } },
    { name: 'raw', input_ts: 'raw.ts', outputs: { dstPath: 'out' } },
  ] },
  { name: 'b', url: 'http://b:32769', encode_preset: [{ name: 'only', input_ts: 'x.ts', outputs: { dstPath: 'o' } }] },
];
const profiles = [{ name: 'P1' }, { name: 'P2' }];

describe('エンコードの設定の空欄を一番上で埋める', () => {
  it('Amatsukaze を選び直すと、一番上のサーバーとそのプリセットが入る', () => {
    const e = fillAmzDefaults(selectEncoder(null, 'amatsukaze_servers'), servers, profiles)!;
    expect(e.encode_link).toBe('http://a:32769');
    expect(e.encode_preset).toEqual({ input_ts: 'cut.ts', mode: 'Test', outputs: { dstPath: 'out', profile: 'HEVC' } });
  });

  it('欄が空なら一番上のプリセットの値（mode・出力先など）。入っている欄は変えない', () => {
    const e = fillAmzDefaults({ encode_type: 'amatsukaze_servers', encode_link: 'http://a:32769',
      encode_preset: { input_ts: 'mine.ts', mode: '', outputs: { dstPath: '' } } }, servers, profiles)!;
    expect(e.encode_preset).toEqual({ input_ts: 'mine.ts', mode: 'Test', outputs: { dstPath: 'out', profile: 'HEVC' } });
  });

  it('一番上のプリセットにもプロファイルが無い時だけ、プロファイルの一番上', () => {
    const e = fillAmzDefaults({ encode_type: 'amatsukaze_servers', encode_link: 'http://b:32769', encode_preset: null }, servers, profiles)!;
    expect(e.encode_preset).toEqual({ input_ts: 'x.ts', outputs: { dstPath: 'o', profile: 'P1' } });
  });

  it('選んである値は変えない（埋まっていれば null）', () => {
    const full = fillAmzDefaults(selectEncoder(null, 'amatsukaze_servers'), servers, profiles)!;
    expect(fillAmzDefaults(full, servers, profiles)).toBeNull();
  });

  it('「〜へ送信」は、送り先の選択肢が届いたら入れ子の中を埋める', () => {
    const sent = selectEncoder(null, 'node:other');
    expect(fillAmzDefaults(effectiveInfo(sent), [], [])).toBeNull();          // まだ届いていない
    const next = fillAmzDefaults(effectiveInfo(sent), servers, profiles)!;    // 届いた
    const info = updateEffective(sent, () => next);
    expect(info.encode_type).toBe('node:other');
    expect(effectiveInfo(info)?.encode_link).toBe('http://a:32769');
  });

  it('アドオンの項目は、既定か（選ぶ形式は）一番上', () => {
    const addon: EncoderAddon = { name: 'q', label: 'Q', params: [
      { key: 'crf', label: 'crf', type: 'number', default: 23 },
      { key: 'preset', label: 'preset', type: 'select', options: ['fast', 'slow'] },
      { key: 'note', label: 'note', type: 'text' },
    ] };
    const info = fillAddonDefaults(selectEncoder(null, 'addon:q'), addon)!;
    expect(info.encode_preset?.params).toEqual({ crf: 23, preset: 'fast' });
    expect(fillAddonDefaults(info, addon)).toBeNull();
  });
});
