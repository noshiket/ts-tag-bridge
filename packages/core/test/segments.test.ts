import { describe, expect, it } from 'vitest';

import { dropEvents, offsetLabel, parseSegment, segmentDrops, toggleSegmentSkip } from '../src';

describe('parseSegment', () => {
  it('区間・SKIP・採用区間・TOT', () => {
    const s = parseSegment('00:30:00.000-01:00:00.000,SKIP,keep(00:31:00.000-00:59:00.000@本編),TOT(2026-11-07T15:30:00,x)');
    expect(s).toMatchObject({ full: false, start: '00:30:00.000', end: '01:00:00.000', skip: true, startSec: 1800, endSec: 3600,
      keep: ['00:31:00.000-00:59:00.000 (本編)'], oldTrims: [], tot: '2026-11-07T15:30:00' });
  });
  it('全体・無い話・旧い除去', () => {
    expect(parseSegment('full')).toMatchObject({ full: true, end: '(全体)', startSec: 5, endSec: Infinity });
    expect(parseSegment('00:00:00.000-00:00:00.000').absent).toBe(true);
    expect(parseSegment('00:00:00.000-00:10:00.000,trim(00:01:00-00:02:00)').oldTrims).toEqual(['00:01:00-00:02:00']);
  });
});

describe('toggleSegmentSkip', () => {
  it('区間のすぐ後ろに付け、外す', () => {
    const segs = ['00:00:00.000-00:10:00.000', '00:10:00.000-00:20:00.000,TOT(a,b)'];
    const on = toggleSegmentSkip(segs, 1);
    expect(on[1]).toBe('00:10:00.000-00:20:00.000,SKIP,TOT(a,b)');
    expect(toggleSegmentSkip(segs, 0)[0]).toBe('00:00:00.000-00:10:00.000,SKIP');
    expect(toggleSegmentSkip(on, 1)[1]).toBe(segs[1]);
  });
});

describe('dropEvents / segmentDrops', () => {
  const start = '2026-11-07T15:00:00';
  const de = { errors: [
    { error_type: 'PACKET_LOSS', tot_time: '2026-11-07T15:10:00.2' }, { error_type: 'PACKET_LOSS', tot_time: '2026-11-07T15:10:00.7' },
    { error_type: 'DUPLICATE_PACKET', tot_time: '2026-11-07T15:10:01' }, { error_type: 'SCRAMBLE', tot_time: '2026-11-07T15:40:00' },
  ] };
  it('害の無いものは除き、同じ秒はまとめる', () => {
    expect(dropEvents(de, start).map((d) => [d.sec, d.scramble, d.n])).toEqual([[600.2, false, 2], [2400, true, 1]]);
    expect(dropEvents(JSON.stringify(de), null)).toEqual([]);
  });
  it('区間ごとの件数', () => {
    const ev = dropEvents(de, start);
    expect(segmentDrops(parseSegment('00:00:00.000-00:30:00.000'), ev)).toMatchObject({ drop: 2, scramble: 0 });
    expect(segmentDrops(parseSegment('00:30:00.000-01:00:00.000'), ev)).toMatchObject({ drop: 0, scramble: 1 });
    expect(segmentDrops(parseSegment('full'), ev).list.length).toBe(2);
    expect(offsetLabel(125.6)).toBe('2分06秒');
  });
});
