import { activeDetailFilterCount, filterAndSortSeries, lastWatchedSeriesId, seriesIdByName, stationFacets } from '@tstag/core';
import { useAlbum, useAlbumCaptures, useWatchHistory } from '@tstag/core/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActiveSeries } from '../../../features/library/album/ActiveSeries';
import { AlbumMenuSheets } from '../../../features/library/album/AlbumMenuSheets';
import { CaptureGrid } from '../../../features/library/CaptureGrid';
import { TabBar } from '../../../features/shell/TabBar';
import { DetailFilterPanel } from '../../../features/library/DetailFilterPanel';
import { useAlbumDetailState } from '../../../features/library/libraryState';
import { SeriesCarousel } from '../../../features/library/SeriesCarousel';
import { useScreenNode } from '../../../lib/state/viewNode';
import { Tab } from '../../../ui/inputs/Chip';
import { FilterToggle } from '../../../ui/inputs/FilterToggle';
import { Chev, More } from '../../../ui/parts/Icons';
import { pullToRefresh } from '../../../ui/gestures/PullToRefresh';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** アルバムの中（元の encode.jsx のアルバム詳細）: 上にシリーズの並び、下に選んだシリーズの動画 */
export default function AlbumScreen() {
  const { t: tx } = useT();
  // series: 開いた時に選ぶシリーズ（動画の「このビデオのライブラリへ移動」から）
  // seriesName: 開いた時に選ぶシリーズの名前（詳細の ↗ から。詳細のタイトル）
  // node: 別のサーバーのアルバムとして開く時（詳細の ↗ から。空文字はこのサーバー）
  const { id, series: seriesParam, seriesName, node: nodeParam } = useLocalSearchParams<{ id: string; series?: string; seriesName?: string; node?: string }>();
  const albumId = Number(id);
  const { theme } = useTheme();
  const viewNode = useScreenNode(nodeParam);
  const [s, set] = useAlbumDetailState();
  const album = useAlbum(albumId, viewNode);
  const captures = useAlbumCaptures(albumId, viewNode, s.tab === 'captures');
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(seriesParam ? Number(seriesParam) : null);
  // 選んでいなければ: 名前の指定 → このアルバムで最後に見たシリーズ → 並びの先頭
  const history = useWatchHistory();
  const initialSeriesId = useMemo(() => {
    const all = album.data?.series ?? [];
    return seriesIdByName(all, seriesName) ?? lastWatchedSeriesId(all, history, viewNode === null);
  }, [album.data, seriesName, history, viewNode]);

  const facets = useMemo(() => stationFacets(album.data), [album.data]);
  const series = useMemo(
    () => filterAndSortSeries(album.data, s.filter, s.seriesSort, s.seriesDir, s.videoSort, s.videoDir),
    [album.data, s.filter, s.seriesSort, s.seriesDir, s.videoSort, s.videoDir],
  );
  const active = series.find((x) => x.id === (selectedSeriesId ?? initialSeriesId)) ?? series[0];
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  // 「…」のメニューとシートは AlbumMenuSheets
  const [menu, setMenu] = useState(false);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} refreshControl={pullToRefresh(album, theme.mute)}>
        <TopBar title={album.data?.name || tx('common.loading2')} right={
          <Pressable onPress={() => setMenu(true)} accessibilityLabel={tx('screens.album.menu')}
            style={[styles.more, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: shadow(theme, 2) }]}>
            <More c={theme.ink} />
          </Pressable>
        } />
        <View style={styles.tabs}>
          <Pressable onPress={back} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
            <Chev s={10} c={theme.ink} d="left" />
            <T mono w={700} size={11}>{tx('common.back')}</T>
          </Pressable>
          <Tab compact label={tx('common.series')} active={s.tab === 'series'} onPress={() => set({ tab: 'series' })} />
          <Tab compact label={tx('library.tab.captures')} active={s.tab === 'captures'} onPress={() => set({ tab: 'captures' })} />
          <View style={styles.grow} />
          {s.tab === 'series' && (
            <FilterToggle label={tx('screens.album.filter')} size={11} open={s.showFilters} count={activeDetailFilterCount(s.filter)}
              onPress={() => set({ showFilters: !s.showFilters })} />
          )}
        </View>

        {album.error && <T size={12} color="#ef4444" style={styles.empty}>{album.error.message}</T>}
        {!album.data && !album.error && <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}

        {album.data && s.tab === 'series' && s.showFilters && album.data.series.length > 0 && (
          <DetailFilterPanel stations={facets.stations} stationCounts={facets.counts}
            filter={s.filter} setFilter={(f) => set({ filter: { ...s.filter, ...f } })}
            seriesSort={s.seriesSort} seriesDir={s.seriesDir} setSeriesSort={(seriesSort, seriesDir) => set({ seriesSort, seriesDir })}
            videoSort={s.videoSort} videoDir={s.videoDir} setVideoSort={(videoSort, videoDir) => set({ videoSort, videoDir })} />
        )}

        {album.data && s.tab === 'series' && (
          <View style={styles.body}>
            {active && (
              <>
                <SeriesCarousel series={series} activeId={active.id} node={viewNode} onSelect={setSelectedSeriesId} />
                <ActiveSeries albumId={albumId} albumName={album.data.name} series={series} active={active}
                  node={viewNode} manualSort={s.seriesSort === 'manual'} onManual={() => set({ seriesSort: 'manual' })}
                  grouped={s.videoSort !== 'manual'} videoDesc={s.videoDir === 'desc'} />
              </>
            )}
            {album.data.series.length === 0 && <T size={12} dim style={styles.empty}>{tx('library.video.empty')}</T>}
            {album.data.series.length > 0 && series.length === 0 && <T size={12} dim style={styles.empty}>{tx('screens.album.noMatch')}</T>}
          </View>
        )}

        {album.data && s.tab === 'captures' && (
          <View style={styles.body}>
            {captures.data ? <CaptureGrid captures={captures.data} node={viewNode} albumId={albumId}
              onPlayAt={(c) => c.video_id != null && router.push({ pathname: '/watch/[id]', params: { id: c.video_id, tot: c.tot! } })} /> : <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}
          </View>
        )}
      </ScrollView>
      <AlbumMenuSheets open={menu} onClose={() => setMenu(false)} albumId={albumId} album={album.data} active={active} node={viewNode}
        onSeriesRenamed={setSelectedSeriesId} back={back} />
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  more: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5 },
  grow: { flex: 1 },
  body: { paddingHorizontal: 18, gap: 12 },
  empty: { textAlign: 'center', padding: 40 },
});
