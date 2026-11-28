import { videoContextLabel, videoListSort } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { PagerBar } from '../../ui/parts/PagerBar';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useLibraryState } from './libraryState';
import { VideoCard } from './VideoCard';
import { useT } from '../../ui/i18n/I18n';

/** ライブラリの「ビデオ」表示（元の LibraryScreen の viewMode='video'）: 全部の動画を1列に。日付・言葉・フォルダと並び替えが効く */
export function VideoListView() {
  const api = useApi();
  const { pageSize } = useTheme();
  const { t: tx } = useT();
  const { viewNode } = useViewNode();
  const [s, set] = useLibraryState();
  const f = s.filter;
  const q = useQuery({
    queryKey: ['library', viewNode ?? '', 'videoList', s.videoPage, pageSize, s.sortBy, s.sortDir, f.dateFrom, f.dateTo, f.text, f.dir],
    queryFn: () => api.library.videoList({
      page: s.videoPage, perPage: pageSize, sort: videoListSort(s.sortBy), dir: s.sortDir, from: f.dateFrom, to: f.dateTo, q: f.text, dirRoot: f.dir,
    }, viewNode),
  });
  const d = q.data;
  const totalPages = d ? Math.max(1, Math.ceil(d.total / pageSize)) : 1;
  const pager = <PagerBar page={s.videoPage} totalPages={totalPages} totalCount={d?.total}
    onPrev={() => set({ videoPage: Math.max(0, s.videoPage - 1) })} onNext={() => set({ videoPage: Math.min(totalPages - 1, s.videoPage + 1) })} />;
  return (
    <View style={styles.list}>
      {d?.total === 0 && !q.isFetching && <T size={12} dim style={styles.empty}>{tx(f.dateFrom || f.dateTo || f.text ? 'library.video.emptyFiltered' : 'library.video.empty')}</T>}
      {!!d?.total && (totalPages <= 1 ? <T mono size={9} dim>{tx('common.count', { n: d.total })}</T> : pager)}
      {q.isFetching && <T size={12} dim style={styles.loading}>{tx('common.loading')}</T>}
      {!q.isFetching && d?.items.map((v) => (
        <VideoCard key={v.id} video={v} node={viewNode} albumName={v.album_name ?? undefined}
          contextLabel={videoContextLabel(v)}
          onPlay={() => router.push({ pathname: '/watch/[id]', params: { id: String(v.id) } })} />
      ))}
      {!!d && totalPages > 1 && pager}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 18, gap: 6 },
  empty: { textAlign: 'center', padding: 40 },
  loading: { textAlign: 'center', padding: 16 },
});
