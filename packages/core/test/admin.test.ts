import { describe, expect, it } from 'vitest';

import { groupNetAllowed, groupServices, networkOf, parseDevicePageSize, permsBody, resolvePageSize, togglePerm, toggleStationGroup } from '../src';

const svc = (onid: number, tsid: number, sid: number, name: string, node?: string) => ({ onid, tsid, sid, service_name: name, _node: node });

describe('利用者の権限', () => {
  it('地デジのマルチ編成は1つにまとめ、BS は局ごと。同じ局は他のサーバーのものもまとめる', () => {
    const g = groupServices([
      svc(32736, 32736, 1024, 'ＱＺＸ総合１'), svc(32736, 32736, 1025, 'ＱＺＸ総合２'), svc(4, 16625, 101, 'QZX BS'), svc(4, 16625, 101, 'QZX BS', 'node2'),
    ]);
    expect(g).toEqual([
      { key: 't32736-32736', label: 'ＱＺＸ総合１', ids: ['32736-32736-1024', '32736-32736-1025'], nodes: [''], sub: 2 },
      { key: 's4-16625-101', label: 'QZX BS', ids: ['4-16625-101'], nodes: ['', 'node2'] },
    ]);
    expect(toggleStationGroup(['*'], g[0]!)).toEqual(['32736-32736-1024', '32736-32736-1025']);
    expect(toggleStationGroup(['32736-32736-1024', '32736-32736-1025', 'x'], g[0]!)).toEqual(['x']);
  });
  it('一覧の切り替えは「全部」を外して個別に', () => {
    expect(togglePerm(['*'], 'epg')).toEqual(['epg']);
    expect(togglePerm(['epg', 'live'], 'epg')).toEqual(['live']);
    expect(permsBody({ screens: ['*'], nodes: [], stations: ['*'], deny_categories: [3], can_write: 1 }))
      .toEqual({ screens: ['*'], nodes: [], stations: ['*'], deny_categories: [3], can_write: true, guides: [], paid: false });
    // 番組表のアドオンの許可も一緒に送る
    expect(permsBody({ screens: ['epg'], nodes: [], stations: [], deny_categories: [], can_write: 0, guides: ['g1'] }).guides).toEqual(['g1']);
  });
});

describe('一覧の件数', () => {
  it('端末の上書きがあればそれ、無ければアカウントの既定', () => {
    expect([parseDevicePageSize('50'), parseDevicePageSize('7'), parseDevicePageSize(null)]).toEqual([50, null, null]);
    expect([resolvePageSize(30, 50), resolvePageSize(30, null), resolvePageSize(undefined, null)]).toEqual([50, 30, 20]);
  });
});

describe('ストレージ', () => {
  it('使っている割合', async () => {
    const { storageUsed } = await import('../src');
    expect(storageUsed({ id: 'a', name: '/mnt', text: '', total: '1000', free: 250 })).toBe(0.75);
    expect(storageUsed({ id: 'a', name: '/mnt', text: '', total: 0, free: 0 })).toBe(1);
  });
});

describe('アドオンの設定', () => {
  it('出す項目と始めの値（保存していない項目は既定値）', async () => {
    const { addonDraft, addonSettingParams, canFireAddon } = await import('../src');
    const p = [{ key: 'on_fail', label: 'x', type: 'bool', default: true }, { key: 'url', label: 'u', required: true }];
    const ev = { name: 'n', label: 'N', target: 'event', params: p, settings: { enabled: true, params: { url: 'http://x' } } };
    expect(addonSettingParams(ev)).toBe(p);
    expect(addonDraft(ev)).toEqual({ enabled: true, params: { on_fail: true, url: 'http://x' } });
    const tab = { ...ev, target: 'player_tab', settings_params: [] };
    expect(addonSettingParams(tab)).toEqual([]);
    expect([canFireAddon(ev), canFireAddon(tab)]).toEqual([true, false]);
  });
});

describe('ロゴ', () => {
  it('帯に分け、いちばん大きいサイズで出す', async () => {
    const { groupLogos, logoDisplaySize } = await import('../src');
    const a = { onid: 32736, sid: 1024, sizes: [{ w: 48, h: 27 }, { w: 64, h: 36 }] };
    const b = { onid: 4, sid: 101, sizes: [] };
    const other = { onid: 32391, sid: 1, sizes: [] };
    expect(groupLogos([a, b, other])).toEqual({ terr: [a], bs: [b], cs: [] });
    expect([logoDisplaySize(a), logoDisplaySize(b)]).toEqual([{ w: 64, h: 36 }, { w: 64, h: 36 }]);
  });
});

describe('局の波（地デジ・BS・CS・その他）', () => {
  it('ONID の範囲で決まる（サーバーと同じ）', () => {
    expect([networkOf(0x7fe0), networkOf(4), networkOf(6), networkOf(7), networkOf(null), networkOf(999)]).toEqual(['GR', 'BS', 'CS', 'CS', 'OTHER', 'OTHER']);
  });
  it('波ごとの許可に入っている局のまとまり', () => {
    const [bs] = groupServices([svc(4, 16625, 141, 'BS')]);
    expect(groupNetAllowed(['net:BS'], bs!)).toBe(true);
    expect(groupNetAllowed(['net:CS'], bs!)).toBe(false);
  });
});
