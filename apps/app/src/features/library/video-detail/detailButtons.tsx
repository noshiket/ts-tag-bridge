import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

export const DETAIL_RED = oklch(0.6, 0.22, 25);

/** 小さめで真ん中に置く操作（消す系を押しにくくするため。元と同じ） */
export function DetailBtn({ children, onPress, disabled, on, color, icon, inline }: {
  children: string; onPress: () => void; disabled?: boolean; on?: boolean; color?: string; icon?: ReactNode; inline?: boolean;
}) {
  const { theme, accent } = useTheme();
  const b = (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, {
      backgroundColor: on ? accent.primary : 'transparent', borderColor: on ? accent.primary : color ?? theme.line, opacity: disabled ? 0.6 : 1,
    }]}>
      {icon}
      <T mono size={10} w={700} color={on ? '#fff' : color ?? theme.ink}>{children}</T>
    </Pressable>
  );
  return inline ? b : <View style={styles.row}>{b}</View>;
}

/** 横いっぱいの大きいボタン（並べ替え・確認のキャンセル/実行） */
export function DetailBig({ children, onPress, disabled, bg }: { children: string; onPress: () => void; disabled?: boolean; bg?: string }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.big, { backgroundColor: bg ?? 'transparent', borderColor: bg ? 'transparent' : theme.frame, opacity: disabled ? 0.4 : 1 }]}>
      <T mono size={13} w={bg ? 800 : 700} color={bg ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

export const detailStyles = StyleSheet.create({
  moves: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  center: { textAlign: 'center' },
});

const styles = StyleSheet.create({
  row: { alignItems: 'center', marginBottom: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1 },
  big: { flex: 1, padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
});
