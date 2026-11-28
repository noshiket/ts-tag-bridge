import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

const RED = oklch(0.6, 0.22, 25);

/** 利用者の権限の編集の部品: 見出し（と説明）・並び・選ぶ札 */
export function H({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={styles.h}>
      <T mono size={9} w={700}>{children}</T>
      {hint && <T mono size={8} dim style={styles.mt2}>{hint}</T>}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Chip({ children, on, onPress, danger }: { children: ReactNode; on: boolean; onPress: () => void; danger?: boolean }) {
  const { theme, accent } = useTheme();
  const c = danger ? RED : accent.primary;
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: on ? c : theme.line, backgroundColor: on ? c : 'transparent' }]}>
      <T mono size={10} w={700} color={on ? '#fff' : theme.mute}>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h: { marginTop: 12, marginBottom: 5 },
  mt2: { marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1 },
});
