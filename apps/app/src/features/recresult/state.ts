import { DEFAULT_REC_FILTERS, type RecFilters } from '@tstag/core';

import { savedState } from '../../lib/state/savedState';

/** 録画結果の画面の状態（詳細などへ移って戻っても残す。元の _recSaved） */
export const useRecResultState = savedState({
  tab: 'rec' as 'rec' | 'encode',
  filters: DEFAULT_REC_FILTERS as RecFilters,
  showFilters: false,
  page: 0,
});
