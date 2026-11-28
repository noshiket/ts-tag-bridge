import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 入力の見出し（req は必須の印） */
export function Label({ children, req }: { children: ReactNode; req?: boolean }) {
  return <T mono size={9} w={700} dim style={styles.label}>{children}{req ? <T mono size={9} color="#ef4444"> *</T> : null}</T>;
}

/** 選択のチップ（パス / アップロード、そのまま / 移動 / コピー） */
export function Chip({ children, on, sub, onPress }: { children: string; on: boolean; sub?: string; onPress: () => void }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: theme.line, backgroundColor: on ? accent.primary : 'transparent' }]}>
      <T mono size={10} w={700} color={on ? '#fff' : theme.ink}>{children}</T>
      {sub && <T mono size={8} color={on ? '#fff' : theme.mute} style={styles.dim}>{sub}</T>}
    </Pressable>
  );
}

/** 横いっぱいの大きいボタン（アップロード） */
export function Big({ children, onPress, disabled }: { children: string; onPress: () => void; disabled?: boolean }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.big, { backgroundColor: disabled ? theme.line : accent.primary }]}>
      <T mono size={11} w={800} color="#fff">{children}</T>
    </Pressable>
  );
}

/** 文字の入力欄の見た目 */
export function useAddInput() {
  const { theme } = useTheme();
  return [formStyles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }];
}

/** 動画追加の入力で共通の並び・余白 */
export const formStyles = StyleSheet.create({
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, fontSize: 12 },
  mono: { fontFamily: monoFamily[400], fontSize: 11 },
  area: { minHeight: 54, textAlignVertical: 'top' },
  area70: { minHeight: 70, textAlignVertical: 'top' },
  hint: { marginTop: 3, lineHeight: 15 },
  note: { marginTop: 6, lineHeight: 15 },
  row6: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  row8: { flexDirection: 'row', gap: 8 },
  f1: { flex: 1, minWidth: 0 },
  f2: { flex: 2, minWidth: 0 },
  mt4: { marginTop: 4 },
});

const styles = StyleSheet.create({
  label: { marginTop: 8, marginBottom: 3 },
  chip: { flex: 1, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
  dim: { opacity: 0.8 },
  big: { marginTop: 8, padding: 10, borderRadius: 10, alignItems: 'center' },
});
