import { describe, expect, it } from 'vitest';

import { canScreen, type Me } from '../src';

const user = (screens: string[], extra: Partial<Me> = {}): Me => ({
  id: 2, username: 'u', is_admin: false,
  perms: { is_admin: false, can_write: false, screens, nodes: [], stations: [], deny_categories: [] }, ...extra,
});

describe('canScreen', () => {
  it('設定は誰でも、ログインしていなければ何も開けない', () => {
    expect(canScreen(user([]), 'settings')).toBe(true);
    expect(canScreen(null, 'settings')).toBe(false);
  });
  it('許された画面だけ（* は全部）', () => {
    expect(canScreen(user(['library']), 'library')).toBe(true);
    expect(canScreen(user(['library']), 'epg')).toBe(false);
    expect(canScreen(user(['*']), 'epg')).toBe(true);
  });
  it('管理者は全部', () => {
    expect(canScreen(user([], { is_admin: 1 }), 'reservations')).toBe(true);
  });
});
