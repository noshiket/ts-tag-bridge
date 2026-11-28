import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SC } from './colors';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { monoFamily } from '../../../ui/theme/theme';
import { shadow } from '../../../ui/theme/edge';

/** パターン登録の区切りのカード（色の枠と影） */
export function EditorCard({ color, w = 1.5, children }: { color: string; w?: number; children: ReactNode }) {
  const { theme } = useTheme();
  return <View style={[s.card, { backgroundColor: theme.surface, borderColor: color, borderWidth: w, boxShadow: shadow(theme, 3, color) }]}>{children}</View>;
}

/** 小さい見出し（欄の上） */
export const Label9 = ({ children }: { children: string }) => <T mono size={9} dim style={s.label9}>{children}</T>;

/** マッチのカードの見出しに置く小さいボタン */
export function SmallBtn({ label, onPress, solid }: { label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.small, solid ? s.smallSolid : s.smallGhost]}>
      <T mono size={9} w={800} color={solid ? SC.matched : '#fff'}>{label}</T>
    </Pressable>
  );
}

/** パターン登録の部品で共通の並び・余白 */
export const editorStyles = StyleSheet.create({
  section: { paddingHorizontal: 18, paddingTop: 14 },
  grow: { flex: 1, minWidth: 0 },
  rowC: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  outline: { padding: 6, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', marginBottom: 8 },
  valBox: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  input: { borderWidth: 1.5, borderRadius: 7, fontFamily: monoFamily[400] },
  warn: { borderWidth: 1, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 8 },
  mb4: { marginBottom: 4 },
  mb6: { marginBottom: 6 },
  mb8: { marginBottom: 8 },
  mb10: { marginBottom: 10 },
  mb12: { marginBottom: 12 },
});

const s = StyleSheet.create({
  card: { borderRadius: 16, padding: 14 },
  label9: { marginBottom: 4, letterSpacing: 0.5 },
  small: editorStyles.small,
  smallGhost: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  smallSolid: { backgroundColor: 'rgba(255,255,255,0.9)' },
});
