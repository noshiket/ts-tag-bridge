import type { EncodeRow } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 'MM/DD hh:mm:ss'（無ければ --） */
const fmt = (iso: string) => {
  if (!iso) return '--';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** TOT / セグメント（終わったものだけ。切り出した区間の時刻と長さ） */
export function JobTot({ e }: { e: EncodeRow }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const hasTot = !!(e.startedAt || e.finishedAt);
  const segs = e.trimSegments;
  if (!hasTot && segs.length === 0) return null;
  const secs = e.startedAt && e.finishedAt ? `${Math.round((new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime()) / 1000)}s` : '';
  return (
    <View style={styles.mt16}>
      <SectionTitle>{tx('encoding.jobTot.segments')}</SectionTitle>
      <View style={[styles.detail, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {hasTot && (
          <View style={[styles.row, segs.length > 0 && { borderBottomWidth: 1.5, borderBottomColor: theme.line }]}>
            <T mono size={10} w={700} color={accent.tertiary} style={styles.l}>TOT</T>
            <T mono size={10} style={styles.c}>{`${fmt(e.startedAt)} – ${fmt(e.finishedAt)}`}</T>
            <T mono size={10} dim style={styles.r}>{secs}</T>
          </View>
        )}
        {segs.map((s, i) => (
          <View key={i} style={[styles.row, i < segs.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
            <T mono size={10} dim style={styles.l}>{`seg.${i + 1}`}</T>
            <T mono size={10} style={styles.c}>{`${fmt(s.start)} – ${fmt(s.end)}`}</T>
            <T mono size={10} color={accent.primary} style={styles.r}>{`${Math.round(s.duration_sec || 0)}s`}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mt16: { marginTop: 16 },
  detail: { borderWidth: 1.5, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  l: { minWidth: 40 },
  c: { flex: 1, textAlign: 'center' },
  r: { minWidth: 40, textAlign: 'right' },
});
