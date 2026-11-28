import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';

/** ロゴの小さな説明文 */
export function LogoNote({ children, style }: { children: ReactNode; style?: object }) {
  return <T mono size={10} dim style={[logoStyles.lh, style]}>{children}</T>;
}

/** ロゴのボタン（on: 主ボタン） */
export function LogoBtn({ children, on, disabled, onPress }: { children: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[styles.btn, { backgroundColor: on ? accent.primary : 'transparent', borderColor: on ? 'transparent' : theme.line, opacity: disabled ? 0.5 : 1 }]}>
      <T mono size={11} w={700} color={on ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

export const logoStyles = StyleSheet.create({
  lh: { lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mt4: { marginTop: 4 },
  mt8: { marginTop: 8 },
  mt10: { marginTop: 10 },
});

const styles = StyleSheet.create({
  btn: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 8, borderWidth: 1 },
});
