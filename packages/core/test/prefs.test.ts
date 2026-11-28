import { describe, expect, it } from 'vitest';

import { prefsPatchBody, type Prefs } from '../src';

describe('prefsPatchBody', () => {
  const current: Prefs = { tweaks: { theme: 'neon', accent: 'electric', pageSize: 20, epgView: 'grid' }, private_categories: [] };
  it('tweaks は今の値に重ねた全体を送る（サーバーは丸ごと置き換えるので、一部だけだと他が消える）', () => {
    expect(prefsPatchBody(current, { tweaks: { epgView: 'week' } })).toEqual({ tweaks: { theme: 'neon', accent: 'electric', pageSize: 20, epgView: 'week' } });
  });
  it('tweaks 以外はそのまま', () => {
    expect(prefsPatchBody(current, { private_categories: ['a'] })).toEqual({ private_categories: ['a'] });
  });
});
