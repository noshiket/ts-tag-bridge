import { describe, expect, it } from 'vitest';

import { recProgress } from '../src';

describe('recProgress', () => {
  it('エンコ済は 5 段', () => {
    expect(recProgress({ state: 'encode_finish', rec_status: 1 })).toEqual({ step: 5, label: 'エンコ済', state: 'encoded', node: null, kind: 'done' });
  });
  it('別のサーバーへ任せた待機はサーバー名を分ける', () => {
    expect(recProgress({ state: 'waiting(node-b)', rec_status: 1 })).toEqual({ step: 3, label: '待機', state: 'waiting', node: 'node-b', kind: 'working' });
  });
  it('キューは待機の段', () => {
    expect(recProgress({ state: 'queued', rec_status: 1 }).step).toBe(3);
  });
  it('録画中は 1 段', () => {
    expect(recProgress({ state: 'pending', rec_status: 0 })).toMatchObject({ step: 1, label: '録画中', state: 'recording' });
  });
  it('失敗は error', () => {
    expect(recProgress({ state: 'encode_error', rec_status: 1 })).toMatchObject({ kind: 'error', label: '失敗' });
  });
});
