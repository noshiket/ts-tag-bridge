import { DEFAULT_RESERVE_FILTERS, type ReserveFilters } from '@tstag/core';

import { savedState } from '../../lib/state/savedState';

/** 予約一覧の絞り込み・ページ（詳細などへ移って戻っても残す。元の _resSaved） */
export const useReserveListState = savedState({
  filters: DEFAULT_RESERVE_FILTERS as ReserveFilters,
  showFilters: false,
  page: 0,
});
