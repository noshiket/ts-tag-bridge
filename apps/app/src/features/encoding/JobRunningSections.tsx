import { encodeQueueSort, type EncodeRow } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';

import { QueuedJobCard } from './SourceAndResult';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** 走っている間の実行ログ（5秒ごとに取り直す。最後の20行） */
export function JobLiveLog({ e, node }: { e: EncodeRow; node: string | null }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const api = useApi();
  const log = useQuery({
    queryKey: ['encodes', node ?? '', 'console', e.id], queryFn: () => api.encodes.console(e.id, node),
    refetchInterval: e.status === 'running' ? 5000 : false,
  });
  return (
    <View style={styles.mt16}>
      <SectionTitle>{tx('encoding.jobRunningSections.log')}</SectionTitle>
      <ScrollView automaticallyAdjustKeyboardInsets style={[styles.log, { borderColor: theme.frame, boxShadow: shadow(theme, 3) }]} nestedScrollEnabled>
        {(log.data ?? []).length === 0
          ? <T mono size={10} color="#D1D5DB" style={styles.dim}>{tx('encoding.jobRunningSections.fetchingLog')}</T>
          : log.data!.slice(-20).map((ln, i) => <T key={i} mono size={10} color="#D1D5DB" style={styles.line}>{ln}</T>)}
      </ScrollView>
    </View>
  );
}

/** 走っている間、次に待っている仕事（2件）を録画カードで */
export function JobParallel({ list, node }: { list: EncodeRow[]; node: string | null }) {
  const { t: tx } = useT();
  return (
    <View style={styles.mt16}>
      <SectionTitle>{tx('encoding.jobRunningSections.parallelJobs')}</SectionTitle>
      <View style={styles.gap8}>
        {encodeQueueSort(list.filter((x) => x.status === 'queued')).slice(0, 2).map((x) => (
          <QueuedJobCard key={`${x.isAddon ? 'a' : 'e'}${x.id}`} e={x} node={node} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mt16: { marginTop: 16 },
  gap8: { gap: 8 },
  dim: { opacity: 0.7 },
  log: { backgroundColor: '#0E0B14', padding: 12, borderRadius: 14, borderWidth: 1.5, maxHeight: 160 },
  line: { lineHeight: 16 },
});
