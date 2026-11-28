import { EMPTY_ALBUM_FILTER, EMPTY_DETAIL_FILTER, type AlbumFilter, type AlbumSort, type DetailFilter, type SeriesSort, type SortDir, type VideoSort } from '@tstag/core';

import { savedState } from '../../lib/state/savedState';

export type LibraryTab = 'albums' | 'mylist' | 'music' | 'local' | 'continue' | 'captures' | 'momentum';

/** ライブラリの一覧 */
export const useLibraryState = savedState({
  tab: 'albums' as LibraryTab,
  viewMode: 'album' as 'album' | 'video',
  showFilters: false,
  filter: EMPTY_ALBUM_FILTER as AlbumFilter,
  sortBy: 'added' as AlbumSort,
  sortDir: 'desc' as SortDir,
  albumPage: 0,
  mylistPage: 0,
  videoPage: 0,
});

/** アルバムの中（どのアルバムでも同じ絞り込み・並び替えを使う。元の Web 版と同じ） */
export const useAlbumDetailState = savedState({
  tab: 'series' as 'series' | 'captures',
  showFilters: false,
  filter: EMPTY_DETAIL_FILTER as DetailFilter,
  seriesSort: 'manual' as SeriesSort,
  seriesDir: 'asc' as SortDir,
  videoSort: 'episode' as VideoSort,
  videoDir: 'asc' as SortDir,
});
