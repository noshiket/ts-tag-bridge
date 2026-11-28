import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';

/** 小さな見出しと値の箱（元の MetaRow）。MetaGrid の中で2列に並べる */
export function MetaRow({ label, value, logo }: { label: string; value: ReactNode; logo?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.surface2 }]}>
      <T mono size={8} dim style={styles.label}>{label.toUpperCase()}</T>
      <View style={styles.value}>
        {logo}
        {typeof value === 'string' || typeof value === 'number' || value == null
          ? <T range mono size={11} w={700} style={styles.shrink}>{value == null ? '' : String(value)}</T>
          : value}
      </View>
    </View>
  );
}

/** MetaRow を2列に並べる */
export function MetaGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { width: '48.5%', flexGrow: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  label: { letterSpacing: 0.5 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  shrink: { flexShrink: 1 },
});
