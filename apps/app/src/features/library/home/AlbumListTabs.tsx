import { activeFilterCount, albumFacets, filterAndSortAlbums, paginate, type AlbumSummary } from '@tstag/core';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Empty, libraryStyles as ls } from './libraryParts';
import { FilterToggle } from '../../../ui/inputs/FilterToggle';
import { PagerBar } from '../../../ui/parts/PagerBar';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { AlbumFilterPanel } from '../AlbumFilterPanel';
import { useLibraryState } from '../libraryState';
import { LocalSaveTab } from '../local-save/LocalSaveTab';
import { VideoListView } from '../VideoListView';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** アルバムのタブ: アルバム/ビデオの切り替え・絞り込みと並べ替え・ページ送り */
export function AlbumsTab({ albums, list }: { albums: AlbumSummary[] | undefined; list: (items: AlbumSummary[]) => ReactNode }) {
  const { theme, pageSize } = useTheme();
  const { t: tx } = useT();
  const [s, set] = useLibraryState();
  const facets = useMemo(() => albumFacets(albums ?? []), [albums]);
  const shown = useMemo(() => filterAndSortAlbums(albums ?? [], s.filter, s.sortBy, s.sortDir), [albums, s.filter, s.sortBy, s.sortDir]);
  const p = paginate(shown, s.albumPage, pageSize);
  const filters = activeFilterCount(s.filter);
  // 絞り込み・並び替えを変えたらページを先頭へ
  const setFilter = (f: Partial<typeof s.filter>) => set({ filter: { ...s.filter, ...f }, albumPage: 0, videoPage: 0 });
  const pager = <PagerBar page={p.page} totalPages={p.totalPages} totalCount={shown.length}
    onPrev={() => set({ albumPage: p.page - 1 })} onNext={() => set({ albumPage: p.page + 1 })} />;

  return (
    <>
      <View style={styles.modeRow}>
        <View style={[styles.segment, { borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
          {(['album', 'video'] as const).map((m) => (
            <Pressable key={m} onPress={() => set({ viewMode: m, videoPage: 0 })} style={[styles.segBtn, { backgroundColor: s.viewMode === m ? theme.ink : theme.surface }]}>
              <T mono w={800} size={10} color={s.viewMode === m ? theme.onInk : theme.ink}>{tx(m === 'album' ? 'library.album.mode.album' : 'library.album.mode.video')}</T>
            </Pressable>
          ))}
        </View>
        {!!albums?.length && <FilterToggle open={s.showFilters} count={filters} onPress={() => set({ showFilters: !s.showFilters })} />}
      </View>
      {s.showFilters && !!albums?.length && (
        <AlbumFilterPanel facets={facets} filter={s.filter} setFilter={setFilter} sortBy={s.sortBy} sortDir={s.sortDir}
          setSort={(sortBy, sortDir) => set({ sortBy, sortDir, albumPage: 0, videoPage: 0 })} />
      )}
      {s.viewMode === 'video' ? (
        <VideoListView />
      ) : !albums ? (
        <Empty>{tx('common.loading')}</Empty>
      ) : (
        <View style={ls.list}>
          {albums.length === 0 && <Empty>{tx('library.album.empty')}</Empty>}
          {albums.length > 0 && shown.length === 0 && <Empty>{tx('library.album.emptyFiltered')}</Empty>}
          {shown.length > 0 && (p.totalPages <= 1 ? <T mono size={9} dim>{tx('common.count', { n: shown.length })}</T> : pager)}
          {list(p.items)}
          {shown.length > 0 && p.totalPages > 1 && pager}
        </View>
      )}
    </>
  );
}

/** マイリスト（この利用者・追加が新しい順） */
export function MylistTab({ albums, ids, list }: { albums: AlbumSummary[] | undefined; ids: number[]; list: (items: AlbumSummary[]) => ReactNode }) {
  const { pageSize } = useTheme();
  const { t: tx } = useT();
  const [s, set] = useLibraryState();
  // アルバムが読めていない id は表示できないので、ページの計算からも除く
  const rows = ids.map((id) => albums?.find((a) => a.id === id)).filter((a): a is AlbumSummary => !!a);
  const p = paginate(rows, s.mylistPage, pageSize);
  const pager = <PagerBar page={p.page} totalPages={p.totalPages} totalCount={rows.length}
    onPrev={() => set({ mylistPage: p.page - 1 })} onNext={() => set({ mylistPage: p.page + 1 })} />;
  if (!albums) return <Empty>{tx('common.loading')}</Empty>;
  return (
    <View style={ls.list}>
      {rows.length === 0 ? <Empty>{tx('library.mylist.empty')}</Empty> : pager}
      {list(p.items)}
      {rows.length > 0 && pager}
    </View>
  );
}

/** ローカル保存のタブ: 絞込（SEARCH だけ。アルバム一覧と同じ言葉を使う）と一覧 */
export function LocalTab({ albums }: { albums: AlbumSummary[] | undefined }) {
  const [s, set] = useLibraryState();
  const facets = useMemo(() => albumFacets(albums ?? []), [albums]);
  const setFilter = (f: Partial<typeof s.filter>) => set({ filter: { ...s.filter, ...f }, albumPage: 0, videoPage: 0 });
  return (
    <>
      {!!albums?.length && (
        <View style={styles.localToggle}>
          <FilterToggle open={s.showFilters} count={activeFilterCount(s.filter)} onPress={() => set({ showFilters: !s.showFilters })} />
        </View>
      )}
      {s.showFilters && !!albums?.length && (
        <AlbumFilterPanel localOnly facets={facets} filter={s.filter} setFilter={setFilter} sortBy={s.sortBy} sortDir={s.sortDir}
          setSort={(sortBy, sortDir) => set({ sortBy, sortDir })} />
      )}
      <LocalSaveTab text={s.filter.text} />
    </>
  );
}

const styles = StyleSheet.create({
  localToggle: { paddingHorizontal: 18, paddingBottom: 8, alignItems: 'flex-end' },
  modeRow: { paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  segment: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 9, overflow: 'hidden' },
  segBtn: { paddingVertical: 5, paddingHorizontal: 12 },
});
