import { describe, expect, it } from 'vitest';

import {
  addonParamValue, canSaveEncodeInfo, defaultEncodeInfo, delegateNodeOf, effectiveInfo, encodeInfoBody, encoderChoices, selectEncoder,
  setAddonParam, updateEffective, type EncodeOptions,
} from '../src';

const o: EncodeOptions = {
  edcb_servers: [{ name: 'e', encode: [{ encode_type: 'amatsukaze_servers', name: 'amz' }] }],
  amatsukaze_servers: [{ name: 'amz', url: 'http://amz:32769' }],
  encoder_addons: [{ name: 'qsv', label: 'QSVEnc', params: [{ key: 'qvbr', label: 'q', type: 'number', default: 3000 }, { key: 'b', label: 'b', type: 'bool' }] }],
  remote_nodes: [{ name: 'node2' }],
};

describe('エンコードの設定', () => {
  it('既定は最初のエンコーダー（Amatsukaze はサーバーの URL も）', () => {
    expect(defaultEncodeInfo(o)).toEqual({ encode_type: 'amatsukaze_servers', encode_link: 'http://amz:32769', encode_preset: null });
    expect(defaultEncodeInfo({})).toBeNull();
  });
  it('選べるもの: 設定・アドオン・送り先', () => {
    expect(encoderChoices(o).map((c) => c.type)).toEqual(['amatsukaze_servers', 'addon:qsv', 'node:node2']);
  });
  it('送る時は送り先の設定を入れ子で編集する', () => {
    const d = selectEncoder(null, 'node:node2');
    expect(delegateNodeOf(d)).toBe('node2');
    expect(effectiveInfo(d)).toEqual({ encode_type: 'amatsukaze_servers', encode_link: '', encode_preset: null });
    const u = updateEffective(d, (e) => ({ ...e, encode_link: 'http://x' }));
    expect(u.encode_type).toBe('node:node2');
    expect(effectiveInfo(u)?.encode_link).toBe('http://x');
    expect(updateEffective(selectEncoder(null, 'amatsukaze_servers'), (e) => ({ ...e, encode_link: 'y' })).encode_link).toBe('y');
  });
  it('アドオンの項目と、保存できるか', () => {
    const a = selectEncoder(null, 'addon:qsv');
    expect(addonParamValue(a, o.encoder_addons![0]!.params![0]!)).toBe(3000);
    expect(addonParamValue(a, o.encoder_addons![0]!.params![1]!)).toBe(false);
    expect(addonParamValue(setAddonParam(a, 'qvbr', 5000), o.encoder_addons![0]!.params![0]!)).toBe(5000);
    expect(canSaveEncodeInfo(a, o, true)).toBe(true);
    expect(canSaveEncodeInfo(a, o, false)).toBe(false);
    expect(canSaveEncodeInfo(selectEncoder(null, 'amatsukaze_servers'), o, true)).toBe(false);
    expect(canSaveEncodeInfo({ encode_type: 'amatsukaze_servers', encode_link: 'u', encode_preset: { mode: 'Batch' } }, o, true)).toBe(true);
    expect(encodeInfoBody({ encode_type: 't', encode_link: '', encode_preset: null, _preset_name: 'x' })).toEqual({ encode_type: 't', encode_link: '', encode_preset: null });
  });
});
