import { describe, expect, it } from 'vitest';

import { canSubmitManualReserve, initManualReserve, manualReserveBody } from '../src';

describe('手動予約', () => {
  const f = { ...initManualReserve(new Date(2026, 10, 8, 3, 0)), service: '32736-32736-1024' };
  it('始めは今日の 20:00〜21:00', () => {
    expect(f).toMatchObject({ startdate: '2026-11-08', starttime: '20:00:00', endtime: '21:00:00', tuijyuuFlag: 1, serviceMode: 1, presetID: '' });
  });
  it('送る中身: 空欄は送らず、題名が無ければ「手動予約」', () => {
    expect(manualReserveBody(f)).toEqual({
      start_date: '2026-11-08', start_time: '20:00:00', end_time: '21:00:00', service_id: '32736-32736-1024', title: '手動予約',
      rec_mode: 1, priority: 2, tuijyuu_flag: 1, tuner_id: 0, suspend_mode: 0, use_def_margin: 1,
      pittari_flag: 0, service_mode: 1, partial_rec_flag: 0, continue_rec_flag: 0, reboot_flag: 0,
    });
    expect(manualReserveBody({ ...f, useDefMargin: 0, startMargin: 10, endMargin: 3, recFolder: 'x', presetID: '0', title: 'A' }))
      .toMatchObject({ title: 'A', start_margin: 10, end_margin: 3, rec_folder: 'x', preset_id: 0 });
  });
  it('局・日付・時刻の形が合わないと送れない', () => {
    expect(canSubmitManualReserve(f)).toBe(true);
    expect(canSubmitManualReserve({ ...f, service: '' })).toBe(false);
    expect(canSubmitManualReserve({ ...f, startdate: '11/8' })).toBe(false);
    expect(canSubmitManualReserve({ ...f, endtime: '25:00:00' })).toBe(false);
  });
});
