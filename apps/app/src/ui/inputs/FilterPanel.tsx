import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { shadow } from '../theme/edge';

/** 絞り込みの箱（元の Web 版の「絞込」で開く枠） */
export function FilterPanel({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
      {children}
    </View>
  );
}

/** 見出し（SORT / GENRE など）と、横に流れる選択肢の1行 */
export function FilterRow({ label, labelWidth = 52, children }: { label: string; labelWidth?: number; children: ReactNode }) {
  return (
    <View style={styles.line}>
      <FilterLabel width={labelWidth}>{label}</FilterLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{children}</ScrollView>
    </View>
  );
}

export function FilterLabel({ children, width = 52 }: { children: string; width?: number }) {
  return <T mono size={9} dim numberOfLines={1} style={[styles.label, { width }]}>{children}</T>;
}

export function ClearButton({ onPress }: { onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.clear, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      <T mono size={10} dim>✕</T>
    </Pressable>
  );
}

export const filterStyles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

const styles = StyleSheet.create({
  panel: { marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 14, gap: 8 },
  line: filterStyles.line,
  // 見出しは縮めない（縮むと「G…」のように切れていた）
  label: { flexShrink: 0 },
  chips: { gap: 5, alignItems: 'center' },
  clear: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1 },
});
