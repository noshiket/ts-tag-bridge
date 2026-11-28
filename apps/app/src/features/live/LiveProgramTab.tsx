import type { liveProgress, OnairEvent } from '@tstag/core';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ProgramText } from '../../ui/parts/ProgramText';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** ライブの「番組情報」（元の ProgramInfoTab の放送中の方）: 時刻・残り・進み、題名、説明、次の番組 */
export function LiveProgramTab({ cur, next, pv }: { cur: OnairEvent | null; next: OnairEvent | null; pv: ReturnType<typeof liveProgress> }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  if (!cur || !pv) return <T size={12} dim style={styles.pad}>{tx('common.noProgramInfo')}</T>;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      <T mono size={11} dim>{`${pv.startStr} – ${pv.endStr}  |  ${tx('live.program.left', { n: pv.remainMin })}${cur.genre ? ` | ${cur.genre}` : ''}`}</T>
      <View style={[styles.bar, { backgroundColor: theme.surface2 }]}><View style={[styles.fill, { width: `${pv.progPct}%` }]} /></View>
      <T range size={16} w={700}>{cur.title || tx('common.noProgramInfo2')}</T>
      {!!cur.description && <ProgramText text={cur.description} size={12} />}
      {!!cur.extended_info && <ProgramText text={cur.extended_info} size={12} />}
      {!!next?.title && (
        <View style={[styles.next, { borderTopColor: theme.line }]}>
          <T size={12} dim><T size={12} w={700} dim>{`NEXT ${pv.nextStr}  `}</T>{next.title}</T>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  wrap: { padding: 16, gap: 8 },
  bar: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#10b981', borderRadius: 999 },
  next: { marginTop: 4, paddingTop: 8, borderTopWidth: 1 },
});
