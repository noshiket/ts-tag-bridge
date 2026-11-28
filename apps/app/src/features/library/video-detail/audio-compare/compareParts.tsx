import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';

/** 字幕・実況の取り込みで共通の色・ボタン・枠 */
export const CMP_RED = '#ef4444';

export function CmpBtn({ children, onPress, disabled, bg, color, border, big }: {
  children: ReactNode; onPress: () => void; disabled?: boolean; bg?: string; color?: string; border?: string; big?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, big && styles.big, {
      backgroundColor: bg ?? 'transparent', borderColor: border ?? (bg ? bg : theme.line), opacity: disabled ? 0.5 : 1,
    }]}>
      <T mono size={big ? 11 : 10} w={700} color={color ?? theme.ink} style={styles.center}>{children}</T>
    </Pressable>
  );
}

/** 薄い枠（surface2 の背景と線は呼ぶ側の theme で） */
export function useBoxStyle() {
  const { theme } = useTheme();
  return [cmpStyles.box, { backgroundColor: theme.surface2, borderColor: theme.line }];
}

export const cmpStyles = StyleSheet.create({
  box: { borderRadius: 9, borderWidth: 1, overflow: 'hidden' },
  grow: { flex: 1, minWidth: 0 },
  mt4: { marginTop: 4, paddingHorizontal: 9 },
});

const styles = StyleSheet.create({
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
  big: { padding: 9 },
  center: { textAlign: 'center' },
});
