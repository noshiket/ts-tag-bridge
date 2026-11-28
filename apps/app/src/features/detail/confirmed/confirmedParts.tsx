import { Pressable, StyleSheet } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 確定値の編集で共通の色・選択肢・形 */
export const CONFIRMED_RED = oklch(0.6, 0.22, 25);
export const CONFIRMED_GREEN = oklch(0.6, 0.2, 145);

export function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.choice, { backgroundColor: active ? theme.ink : theme.surface2, borderColor: theme.line }]}>
      <T mono size={9} w={800} color={active ? theme.onInk : theme.mute}>{label}</T>
    </Pressable>
  );
}

export const confirmedStyles = StyleSheet.create({
  block: { paddingVertical: 10, paddingHorizontal: 12 },
  ls: { letterSpacing: 0.5 },
  pill: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, flexShrink: 0, alignSelf: 'center' },
  grow: { flex: 1 },
  input: { flex: 1, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, fontSize: 10, fontFamily: monoFamily[400] },
  multi: { minHeight: 40, textAlignVertical: 'top' },
  small: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, borderWidth: 1, flexShrink: 0 },
  choices: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
});

const styles = StyleSheet.create({
  choice: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 5, borderWidth: 1 },
});
