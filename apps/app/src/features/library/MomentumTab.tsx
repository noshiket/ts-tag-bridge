import { videoContextLabel } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { Chip } from '../../ui/inputs/Chip';
import { PagerBar } from '../../ui/parts/PagerBar';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { VideoCard } from './VideoCard';
import { useT } from '../../ui/i18n/I18n';

const PERIODS = [['week', 'WEEK'], ['month', 'MONTH'], ['year', 'YEAR']] as const;

/** 勢い（元の MomentumList）: コメントの勢い（件数/分）の順。期間（週・月・年）とページ */
export function MomentumTab() {
  const { t: tx } = useT();
  const api = useApi();
  const { accent, pageSize } = useTheme();
  const { viewNode } = useViewNode();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [period, pageSize]);
  const q = useQuery({
    queryKey: ['library', viewNode ?? '', 'momentum', period, page, pageSize],
    queryFn: () => api.library.momentum(period, page, pageSize, viewNode),
  });
  const d = q.data;
  const perPage = d?.per_page || pageSize;
  const totalPages = d ? Math.max(1, Math.ceil(d.total / perPage)) : 1;
  const pager = <PagerBar page={page} totalPages={totalPages} totalCount={d?.total}
    onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />;

  return (
    <View style={styles.list}>
      <View style={styles.periods}>
        {PERIODS.map(([k, l]) => <Chip key={k} size="sm" color={accent.primary} active={period === k} onPress={() => setPeriod(k)}>{l}</Chip>)}
      </View>
      {!q.isFetching && d && (totalPages <= 1 ? <T mono size={9} dim>{tx('common.items', { v0: d.total })}</T> : pager)}
      {q.isFetching && <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}
      {!q.isFetching && d?.items.length === 0 && <T size={12} dim style={styles.empty}>{tx('library.momentumTab.noVideosCommentsPeriod')}</T>}
      {!q.isFetching && d?.items.map((v, i) => (
        <View key={v.id} style={styles.rank}>
          <T mono size={12} w={800} dim style={styles.no}>{String(page * perPage + i + 1)}</T>
          <View style={styles.grow}>
            <VideoCard video={v} node={viewNode} contextLabel={videoContextLabel(v)}
              onPlay={() => router.push({ pathname: '/watch/[id]', params: { id: String(v.id) } })} />
          </View>
        </View>
      ))}
      {!q.isFetching && d && totalPages > 1 && <View style={styles.bottom}>{pager}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 18, gap: 8 },
  periods: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  empty: { textAlign: 'center', padding: 40 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  no: { width: 22, textAlign: 'center' },
  grow: { flex: 1, minWidth: 0 },
  bottom: { paddingTop: 12 },
});
