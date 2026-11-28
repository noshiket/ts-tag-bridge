import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESERVE_FILTERS, activeReserveFilterCount, episodeKind, filterReserves, recordingProgress, reserveFacets,
  reserveFolder, reserveStatus, reserveTimes, tunerMapOf, overlappingReserves, TUNER_SHORTAGE, type Reserve, type ReserveFilters,
} from '../src';

const res = (id: number, p: Partial<Reserve> = {}): Reserve => ({
  reserve_id: id, onid: 4, tsid: 1, sid: 211, event_id: id, title: `番組${id}`, station_name: 'BS99', genre: 'アニメ / 特撮 > 国内アニメ',
  start_time: '2026-11-07T22:00:00+09:00', duration_sec: 1800, description: '', rec_enabled: 1, rule_state: 'pending',
  rule_id: 1, auto_add_id: null, action: 'encode', overlap_mode: 0, comment: '', size: '', tags: [],
  confirmed: null, parser_error: [], duplicate_count: 0, auto_skip_reason: null, ...p,
});
const at = (iso: string) => Date.parse(iso);
const f = (p: Partial<ReserveFilters>): ReserveFilters => ({ ...DEFAULT_RESERVE_FILTERS, ...p });

describe('reserveStatus', () => {
  it('無効はスキップ、時刻が開始〜終了の間なら録画中', () => {
    expect(reserveStatus(res(1, { rec_enabled: 0 }), 0)).toBe('skipped');
    expect(reserveStatus(res(1), at('2026-11-07T21:59:00+09:00'))).toBe('scheduled');
    expect(reserveStatus(res(1), at('2026-11-07T22:10:00+09:00'))).toBe('recording');
    expect(reserveStatus(res(1), at('2026-11-07T22:30:00+09:00'))).toBe('scheduled');
  });
  it('録画ルールの状態を使う（done は完了、recording はそのまま）', () => {
    expect(reserveStatus(res(1, { rule_state: 'done' }), 0)).toBe('encoded');
    expect(reserveStatus(res(1, { rule_state: 'recording' }), 0)).toBe('recording');
    expect(reserveStatus(res(1, { rule_state: 'error' }), 0)).toBe('error');
  });
});

describe('reserveTimes / recordingProgress', () => {
  it('端末の時刻で開始・終了・分', () => {
    const t = reserveTimes(res(1, { start_time: new Date(2026, 10, 7, 23, 45).toISOString(), duration_sec: 1800 }));
    expect(t).toEqual({ start: '2026-11-07 23:45', end: '2026-11-08 00:15', durationMin: 30 });
  });
  it('進み具合は 0〜1 に収める', () => {
    expect(recordingProgress(res(1), at('2026-11-07T22:15:00+09:00'))).toBeCloseTo(0.5);
    expect(recordingProgress(res(1), at('2026-11-07T23:00:00+09:00'))).toBe(1);
  });
});

describe('フォルダ・話数', () => {
  it('複数話は配列', () => {
    expect(reserveFolder(res(1, { confirmed: { folder: ['A', '', 'B'] } }))).toBe('A, B');
    expect(episodeKind(res(1, { confirmed: { episode_number: ['1', '2'] } }))).toBe('multi');
    expect(episodeKind(res(1, { confirmed: { episode_number: ['1'] } }))).toBe('single');
    expect(episodeKind(res(1, { confirmed: { episode_number: '' } }))).toBe('none');
  });
});

describe('filterReserves / reserveFacets', () => {
  const now = at('2026-11-07T12:00:00+09:00');
  const list = [
    res(3, { start_time: '2026-11-08T01:00:00+09:00', station_name: 'MINATO TV', confirmed: { folder: ['X'] } }),
    res(1, { rec_enabled: 0, auto_skip_reason: 'duplicate' }),
    res(2, { rec_enabled: 0, parser_error: ['err'], genre: 'ドラマ > 国内ドラマ' }),
  ];
  it('開始の早い順', () => {
    expect(filterReserves(list, DEFAULT_RESERVE_FILTERS, now).map((r) => r.reserve_id)).toEqual([1, 2, 3]);
  });
  it('予約・スキップの内訳', () => {
    expect(filterReserves(list, f({ status: 'scheduled' }), now).map((r) => r.reserve_id)).toEqual([3]);
    expect(filterReserves(list, f({ status: 'skip', skip: 'dup' }), now).map((r) => r.reserve_id)).toEqual([1]);
    expect(filterReserves(list, f({ status: 'skip', skip: 'other' }), now).map((r) => r.reserve_id)).toEqual([2]);
  });
  it('局・日・フォルダ・ジャンル・エラー・文字', () => {
    expect(filterReserves(list, f({ station: 'MINATO TV' }), now).map((r) => r.reserve_id)).toEqual([3]);
    expect(filterReserves(list, f({ date: '2026-11-08' }), now).map((r) => r.reserve_id)).toEqual([3]);
    expect(filterReserves(list, f({ folder: 'with' }), now).map((r) => r.reserve_id)).toEqual([3]);
    expect(filterReserves(list, f({ genre: 'ドラマ' }), now).map((r) => r.reserve_id)).toEqual([2]);
    expect(filterReserves(list, f({ parserErr: 'yes' }), now).map((r) => r.reserve_id)).toEqual([2]);
    expect(filterReserves(list, f({ text: 'minato' }), now).map((r) => r.reserve_id)).toEqual([3]);
  });
  it('チューナーは割り当てを渡した時だけ絞る', () => {
    const tuners = tunerMapOf([{ tuner_name: 'BonDriver_PX', reserve_ids: [2] }]);
    expect(filterReserves(list, f({ tuner: 'BonDriver_PX' }), now, tuners).map((r) => r.reserve_id)).toEqual([2]);
    expect(filterReserves(list, f({ tuner: 'BonDriver_PX' }), now).length).toBe(3);
  });
  it('数え方', () => {
    const c = reserveFacets(list, now, ['b', 'a', 'a']);
    expect([c.all, c.scheduled, c.skipDup, c.skipOther]).toEqual([3, 1, 1, 1]);
    expect(c.stations).toEqual([['BS99', 2], ['MINATO TV', 1]]);
    expect(c.dates).toEqual(['2026-11-07', '2026-11-08']);
    expect(c.genres).toEqual([['アニメ / 特撮', 2], ['ドラマ', 1]]);
    expect(c.tuners).toEqual(['a', 'b']);
    expect(activeReserveFilterCount(f({ station: 'x', folder: 'with', status: 'skip' }))).toBe(2);
  });
});

describe('並び（録画中 → チューナー不足 → ほか）と重なる予約', () => {
  const now = at('2026-11-07T22:10:00+09:00');
  const list = [
    res(1, { start_time: '2026-11-07T23:00:00+09:00' }),
    res(2, { start_time: '2026-11-08T03:00:00+09:00' }),
    res(3, { start_time: '2026-11-07T22:00:00+09:00' }),
    res(4, { start_time: '2026-11-07T23:30:00+09:00' }),
  ];
  it('チューナー不足は録画中の次に、その中は開始の早い順', () => {
    const tuners = new Map([[2, TUNER_SHORTAGE], [4, TUNER_SHORTAGE], [1, 'BonDriver_X']]);
    expect(filterReserves(list, DEFAULT_RESERVE_FILTERS, now, tuners).map((r) => r.reserve_id)).toEqual([3, 4, 2, 1]);
    // 割り当てが分からない時は今まで通り（録画中が先、あとは開始順）
    expect(filterReserves(list, DEFAULT_RESERVE_FILTERS, now).map((r) => r.reserve_id)).toEqual([3, 1, 4, 2]);
  });
  it('放送時間が重なる予約（自分と、接するだけの物は除く）', () => {
    // 1: 23:00-23:30 / 4: 23:30-24:00 は接するだけ / 5: 23:10-23:20 は中に入る / 6: 22:50-23:05 は頭に掛かる
    const more = [...list, res(5, { start_time: '2026-11-07T23:10:00+09:00', duration_sec: 600 }), res(6, { start_time: '2026-11-07T22:50:00+09:00', duration_sec: 900 })];
    expect(overlappingReserves(list[0]!, more).map((r) => r.reserve_id)).toEqual([6, 5]);
  });
});
