import { describe, expect, it } from 'vitest';

import {
  bandOfOnid, channelOf, editDistance, findReserve, genreOf, groupChannels, inWindow, isUnified, programFlags, programStatus,
  reserveMaps, todayAt4, weekOptions, type EpgEvent, type Reserve,
} from '../src';

const ev = (p: Partial<EpgEvent>): EpgEvent => ({
  onid: 32736, tsid: 32736, sid: 1024, event_id: 1, title: 'T', description: '', start_time: '2026-11-08T10:00:00+09:00',
  duration_sec: 1800, content_nibble: null, free_ca: true, ...p,
});

describe('1日の区切り', () => {
  it('朝4時（4時前は前の日）と8日の選択肢', () => {
    expect(new Date(todayAt4(new Date(2026, 10, 8, 3, 0).getTime())).getDate()).toBe(7);
    expect(new Date(todayAt4(new Date(2026, 10, 8, 5, 0).getTime())).getHours()).toBe(4);
    const w = weekOptions(new Date(2026, 10, 8, 12, 0).getTime());
    expect([w.length, w[0]!.label]).toEqual([8, '11/8(日) 04:00']);
  });
  it('その日にかかる番組', () => {
    const start = new Date('2026-11-08T04:00:00+09:00').getTime();
    expect(inWindow(ev({ start_time: '2026-11-08T03:45:00+09:00', duration_sec: 1800 }), start)).toBe(true);
    expect(inWindow(ev({ start_time: '2026-11-09T04:00:00+09:00' }), start)).toBe(false);
  });
});

describe('局のまとめ方', () => {
  const ch = (onid: number, tsid: number, sid: number, name: string, rk = 0) =>
    channelOf({ onid, tsid, sid, service_name: name, remote_control_key_id: rk }, 0);
  it('同じ TS・近い SID・名前1文字違いを1列に（SID が飛んでいても）', () => {
    const g = groupChannels([ch(32375, 1, 29752, 'みどりテレ１', 3), ch(32375, 1, 29754, 'みどりテレ２', 3), ch(32736, 2, 1024, 'ＱＺＸ総合', 1)]);
    expect(g.map((x) => [x.name, x.subChannels.length])).toEqual([['ＱＺＸ総合', 1], ['みどりテレ', 2]]);
  });
  it('名前が違えば別の列、編集距離', () => {
    expect(groupChannels([ch(4, 16625, 101, 'QZX BS'), ch(4, 16625, 102, 'BSひかり')]).length).toBe(2);
    expect([editDistance('ab', 'ab'), editDistance('ab', 'ac'), editDistance('a', 'abc')]).toEqual([0, 1, 2]);
  });
  it('同じ TS でも別の局（CS の通販チャンネルと映画チャンネル）は別の列・帯', () => {
    expect(groupChannels([ch(6, 24704, 55, '通販チャンネル'), ch(6, 24704, 218, '映画チャンネル')]).length).toBe(2);
    expect([bandOfOnid(4), bandOfOnid(7), bandOfOnid(32736)]).toEqual(['bs', 'cs', 'terr']);
  });
});

describe('番組', () => {
  it('ジャンルと印', () => {
    expect([genreOf(0x0700), genreOf(null), genreOf(0x0E00)]).toEqual(['anime', 'var', 'var']);
    expect(programFlags({ title: 'ポコロ[字][新]', description: '再放送', audio_info: '' })).toEqual(['字', '再', '新']);
  });
  it('サブチャンネルで同じ番組なら1本にまとめる', () => {
    const a = ev({ title: 'A' });
    expect(isUnified([[a], [ev({ title: 'A', sid: 1025 })]], a, 0)).toBe(true);
    expect(isUnified([[a], [ev({ title: 'B', sid: 1025 })]], a, 0)).toBe(false);
    expect(isUnified([[a], []], a, 0)).toBe(true);
  });
  it('予約: 番組そのもの、無ければ同じ題名（録画を優先）', () => {
    const r = (p: Partial<Reserve>): Reserve => ({
      reserve_id: 1, onid: 32736, tsid: 32736, sid: 1024, event_id: 1, title: 'T', station_name: '', genre: '', start_time: null, duration_sec: 0,
      description: '', rec_enabled: 1, rule_state: null, rule_id: null, auto_add_id: null, action: null, overlap_mode: 0, comment: '', size: '',
      tags: [], confirmed: null, parser_error: [], duplicate_count: 0, auto_skip_reason: null, ...p,
    });
    const list = [r({ event_id: 2, rec_enabled: 0 }), r({ event_id: 3, title: 'U' }), r({ event_id: 4, title: 'U', rec_enabled: 0 })];
    const m = reserveMaps(list);
    expect(programStatus(m, ev({ event_id: 2 }))).toBe('skip');
    expect(programStatus(m, ev({ event_id: 9 }))).toBe('skip');
    expect(programStatus(m, ev({ event_id: 9, title: 'U' }))).toBe('rec');
    expect(programStatus(m, ev({ event_id: 4, title: 'U' }))).toBe('skip');
    expect(findReserve(list, ev({ event_id: 3 }))?.title).toBe('U');
  });
});
