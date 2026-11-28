import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';

/** 切り抜きのボタン。fill: 横いっぱいの主ボタン、small: 小さい補助、on: 入/切の表示 */
export function ClipBtn({ children, onPress, fill, small, on }: { children: ReactNode; onPress: () => void; fill?: boolean; small?: boolean; on?: boolean }) {
  const { theme, accent } = useTheme();
  const primary = fill || on;
  return (
    <Pressable onPress={onPress} style={[styles.btn, small && styles.small, fill && clipStyles.grow,
      { backgroundColor: primary ? accent.primary : on === false ? 'transparent' : theme.surface, borderColor: theme.line }]}>
      <T mono size={11} w={700} color={primary ? '#fff' : small ? theme.mute : theme.ink}>{children}</T>
    </Pressable>
  );
}

/** 枠（surface2 の背景と線） */
export function useClipBox() {
  const { theme } = useTheme();
  return [clipStyles.box, { backgroundColor: theme.surface2, borderColor: theme.line }];
}

export const clipStyles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8, gap: 2 },
  row: { flexDirection: 'row', gap: 6, marginTop: 7 },
  grow: { flex: 1 },
  mb6: { marginBottom: 6 },
  mt4: { marginTop: 4 },
  mt8: { marginTop: 8 },
  big: { paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
});

const styles = StyleSheet.create({
  btn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  small: { paddingVertical: 3, paddingHorizontal: 8 },
});
