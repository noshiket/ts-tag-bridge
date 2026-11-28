import { describe, expect, it } from 'vitest';

import { lastWatchedSeriesId, seriesIdByName } from '../src';
import type { Series, Video, WatchEntry } from '../src';

const v = (id: number, sid: number | null, eid: number | null, start: string | null): Video =>
  ({ id, sid, eid, eit_start_time: start } as unknown as Video);
const s = (id: number, name: string, videos: Video[]): Series => ({ id, name, videos } as unknown as Series);
const w = (lastId: string, updatedAt: string, extra: Partial<WatchEntry> = {}): WatchEntry =>
  ({ lastType: 'video', lastId, fileKey: `video:${lastId}`, updatedAt, sid: null, eid: null, eitStart: null, ...extra } as unknown as WatchEntry);

const album = [
  s(1, 'A', [v(10, 100, 1, '2026-11-01T20:00:00+09:00')]),
  s(2, 'B', [v(20, 100, 2, '2026-11-08T20:00:00+09:00')]),
];

describe('アルバムを開いた時のシリーズ', () => {
  it('同じサーバーなら、最後に見た動画の番号のシリーズ', () => {
    expect(lastWatchedSeriesId(album, [w('10', '2026-11-10'), w('20', '2026-11-12')], true)).toBe(2);
    expect(lastWatchedSeriesId(album, [w('20', '2026-11-12'), w('10', '2026-11-15')], true)).toBe(1);
  });
  it('別のサーバーなら、番号ではなく放送（sid・eid・放送日）で合わせる', () => {
    // 番号 10 は別のサーバーでは別の動画かもしれないので使わない
    expect(lastWatchedSeriesId(album, [w('10', '2026-11-15')], false)).toBe(null);
    expect(lastWatchedSeriesId(album, [w('999', '2026-11-15', { sid: 100, eid: 2, eitStart: '2026-11-08T20:00:00+09:00' })], false)).toBe(2);
    // eid が同じでも放送日が違えば別の回
    expect(lastWatchedSeriesId(album, [w('999', '2026-11-15', { sid: 100, eid: 2, eitStart: '2026-11-15T20:00:00+09:00' })], false)).toBe(null);
  });
  it('見ていなければ null（先頭を選ぶ）', () => {
    expect(lastWatchedSeriesId(album, [], true)).toBe(null);
    expect(lastWatchedSeriesId(album, undefined, true)).toBe(null);
  });
  it('詳細から開いた時は、タイトルと同じ名前のシリーズ', () => {
    expect(seriesIdByName(album, ' B ')).toBe(2);
    expect(seriesIdByName(album, 'C')).toBe(null);
    expect(seriesIdByName(album, '')).toBe(null);
  });
});
