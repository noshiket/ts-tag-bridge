import type { Action } from '@tstag/core';

import type { ShoboiApply } from './ShoboiPanel';

/** しょぼいカレンダーのパネルで選んだものをアクションの並びに入れる（同じ欄のアクションがあれば置き換え） */
export function applyShoboiToActions(p: Action[], a: ShoboiApply): Action[] {
  if (a.type === 'tid') return p.map((x) => (x.type === 'getShoboiSubtitle' || x.type === 'getShoboiEpisode' ? { ...x, tid: a.value } : x));
  if (a.type === 'getShoboiSubtitle') {
    const n: Action = { type: 'getShoboiSubtitle', field: a.field || 'subtitle', tid: a.tid || '', episodeField: a.episodeField || 'episode' };
    const i = p.findIndex((x) => x.type === 'getShoboiSubtitle' && x.field === n.field);
    return i >= 0 ? p.map((x, j) => (j === i ? n : x)) : [...p, n];
  }
  const i = p.findIndex((x) => x.type === 'setStr' && x.field === a.field);
  return i >= 0 ? p.map((x, j) => (j === i ? { ...x, str: a.str } : x)) : [...p, { type: 'setStr', field: a.field, str: a.str }];
}

/** 選んだもので決まった TID（以後しょぼいのアクションを足した時の既定）。決まらなければ空 */
export const shoboiTidOf = (a: ShoboiApply): string => (a.type === 'tid' ? a.value : a.type === 'getShoboiSubtitle' ? a.tid || '' : '');
