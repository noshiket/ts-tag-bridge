import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';

/** チェックボックス（四角の印と文字）。押すと onPress */
export function Check({ on, label, disabled, onPress }: { on: boolean; label: string; disabled?: boolean; onPress: () => void }) {
  const { theme, accent } = useTheme();
  const lit = on && !disabled;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }}
      style={[styles.check, { opacity: disabled ? 0.4 : 1 }]}>
      <View style={[styles.box, { borderColor: lit ? accent.primary : theme.mute, backgroundColor: lit ? accent.primary : 'transparent' }]}>
        {lit && <T size={8} w={800} color="#fff">✓</T>}
      </View>
      <T mono size={11} style={styles.shrink}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  shrink: { flexShrink: 1 },
});
