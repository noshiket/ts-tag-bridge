import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chev } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

// 設定のタブで共通の見た目（元の settings.jsx / encode.jsx の枠と SRow）

/** 枠（影つき）。pad で中に余白 */
export function Card({ children, color, pad }: { children: ReactNode; color?: string; pad?: boolean }) {
  const { theme } = useTheme();
  const c = color ?? theme.frame;
  return <View style={[styles.card, pad && styles.cardPad, { backgroundColor: theme.surface, borderColor: c, boxShadow: shadow(theme, 3, c) }]}>{children}</View>;
}

/** 項目名と値の1行（元の SRow） */
export function SRow({ title, titleEn, value, valueColor, last, onPress }: {
  title: string; titleEn?: string; value: string; valueColor?: string; last?: boolean; onPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      <View style={styles.grow}>
        <T size={12} w={500}>{title}</T>
        {titleEn && <T mono size={9} dim>{titleEn}</T>}
      </View>
      <T mono size={11} w={700} color={valueColor} style={styles.value}>{value}</T>
      <Chev s={10} c={theme.mute} />
    </Pressable>
  );
}

export function Loading() {
  const { t: tx } = useT();
  return <T mono size={10} dim style={styles.loading}>{tx('common.loading')}</T>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  cardPad: { paddingVertical: 12, paddingHorizontal: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13 },
  grow: { flex: 1 },
  value: { marginRight: 6 },
  loading: { paddingVertical: 12, paddingHorizontal: 13 },
});
