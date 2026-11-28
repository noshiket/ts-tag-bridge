import { describe, expect, it } from 'vitest';

import { liveProgress, resolveLiveChannel, type LiveChannel } from '../src';

const ch = (sid: number, onid: number): LiveChannel => ({ display_channel_id: `x${sid}`, channel_type: 'GR', network_id: onid, service_id: sid, transport_stream_id: 1, service_name: '' });

describe('ライブ', () => {
  it('SID が無ければ同じ局の主チャンネルへ回す', () => {
    const list = [ch(1024, 32736), ch(1032, 32737)];
    expect(resolveLiveChannel(list, 1024, 32736)!.service_id).toBe(1024);
    expect(resolveLiveChannel(list, 1025, 32736)!.service_id).toBe(1024);
    expect(resolveLiveChannel(list, 9, 4)).toBeNull();
  });
  it('放送中の番組の進みと残り', () => {
    const start = Date.parse('2026-11-08T22:00:00+09:00');
    const p = liveProgress({ title: 'a', start_time: '2026-11-08T22:00:00+09:00', duration_sec: 1800 }, { title: 'b', start_time: '2026-11-08T22:30:00+09:00', duration_sec: 600 }, start + 600_000)!;
    expect(p.progPct).toBeCloseTo(33.33, 1);
    expect(p.remainMin).toBe(20);
    expect(liveProgress(null, null)).toBeNull();
  });
});
