import { dropEvents, offsetLabel, parseSegment, segmentDrops, toggleSegmentSkip } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { Card } from './Card';
import { useT, localizeFmt } from '../../ui/i18n/I18n';

/** 区切りは JSON の文字列で届くこともある */
export const segmentsOf = (v: string[] | string | null | undefined): string[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } }
  return [];
};

/**
 * 分割の区切り（元の split.jsx の SegmentsInfo）: 話ごとの頭のコマ・区間・採用区間・放送時刻と、
 * その区間の drop / scramble（話の頭からの位置）。SKIP でエンコードから外す・ON で戻す
 */
export function SegmentsInfo({ segments, dbRecId, node, dropError, recordingStart, onChanged, right }: {
  segments: string[];
  dbRecId: number;
  node: string | null;
  dropError: unknown;
  recordingStart: string | null;
  onChanged: () => void;
  /** 見出しの右（「→ 分割画面」） */
  right?: ReactNode;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const events = useMemo(() => dropEvents(dropError, recordingStart), [dropError, recordingStart]);
  const toggle = async (i: number) => {
    await api.recordings.setSegments(dbRecId, toggleSegmentSkip(segments, i), node);
    onChanged();
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <SectionTitle>{tx('detail.segmentsInfo.segments')}</SectionTitle>
        {right}
      </View>
      <Card flat>
        {segments.length === 0 ? <T size={12} dim style={styles.none}>{tx('detail.segmentsInfo.none')}</T> : segments.map((raw, i) => {
          const s = parseSegment(raw);
          const d = segmentDrops(s, events);
          const segStart = s.full ? 0 : s.startSec;
          return (
            <View key={i} style={[styles.row, { opacity: s.skip ? 0.4 : 1 }, i < segments.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
              <T mono size={10} w={800} dim style={styles.no}>{`#${i + 1}`}</T>
              {s.absent ? (
                <View style={[styles.frame, styles.missing, { backgroundColor: theme.surface2, borderColor: theme.line }]}><T mono size={9} dim>MISSING</T></View>
              ) : (
                <Image source={{ uri: api.recordings.frameUrl(dbRecId, s.startSec, node), headers: api.client.authHeaders() }}
                  style={[styles.frame, { borderColor: theme.frame }]} contentFit="cover" />
              )}
              <View style={styles.body}>
                <T mono size={11} style={s.skip && styles.strike}>{s.start}</T>
                <T mono size={10} dim style={s.skip && styles.strike}>{`→ ${s.end}`}</T>
                {s.skip && <T mono size={9} w={700} color={oklch(0.55, 0.2, 25)}>SKIP</T>}
                {s.tot && <T mono size={9} color={oklch(0.55, 0.15, 250)}>{`TOT ${s.tot.replace('T', ' ')}`}</T>}
                {s.keep.map((k) => <T key={k} mono size={9} dim>{tx('detail.segmentsInfo.keep', { v0: k })}</T>)}
                {s.oldTrims.map((k) => <T key={k} mono size={9} color={oklch(0.6, 0.22, 25)}>{tx('detail.segmentsInfo.removedOld', { v0: k })}</T>)}
                {d.list.length > 0 && (
                  <View style={styles.drops}>
                    {d.drop > 0 && <View style={[styles.badge, { backgroundColor: oklch(0.6, 0.22, 25) }]}><T mono size={9} w={800} color="#fff">{`DROP ${d.drop}`}</T></View>}
                    {d.scramble > 0 && <View style={[styles.badge, { backgroundColor: oklch(0.62, 0.2, 300) }]}><T mono size={9} w={800} color="#fff">{`SCR ${d.scramble}`}</T></View>}
                    <T mono size={9} dim>{d.list.slice(0, 3).map((x) => localizeFmt(offsetLabel(x.sec - segStart))).join(', ') + (d.list.length > 3 ? tx('detail.segmentsInfo.more', { v0: d.list.length - 3 }) : '')}</T>
                  </View>
                )}
              </View>
              {!s.absent && (
                <Pressable onPress={() => void toggle(i)} accessibilityLabel={s.skip ? tx('detail.segmentsInfo.includeEncodingAgain') : tx('detail.segmentsInfo.excludeEncoding')}
                  style={[styles.skip, s.skip
                    ? { borderColor: oklch(0.55, 0.2, 145), backgroundColor: oklch(0.9, 0.05, 145) }
                    : { borderColor: oklch(0.55, 0.2, 25), backgroundColor: oklch(0.93, 0.05, 25) }]}>
                  <T mono size={9} w={700} color={s.skip ? oklch(0.35, 0.15, 145) : oklch(0.4, 0.2, 25)}>{s.skip ? 'ON' : 'SKIP'}</T>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  wrap: { marginTop: 16 },
  none: { paddingVertical: 9, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14 },
  no: { minWidth: 24 },
  frame: { width: 80, height: 45, borderRadius: 6, borderWidth: 1 },
  missing: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  strike: { textDecorationLine: 'line-through' },
  drops: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  badge: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4 },
  skip: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
});
