import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Plus } from '../../../ui/parts/Icons';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 「＋ アクション追加」の点線ボタン。nested は入れ子のアクションの中に置く小さい方 */
export function AddActionButton({ onPress, children, nested }: { onPress: () => void; children: ReactNode; nested?: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[nested ? styles.nested : styles.top, { borderColor: theme.line }]}>
      <Plus s={9} c={theme.mute} w={2.5} /><T mono size={nested ? 9 : 10} dim>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', marginBottom: 8 },
  nested: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 5, borderRadius: 7, borderWidth: 1.5, borderStyle: 'dashed' },
});
