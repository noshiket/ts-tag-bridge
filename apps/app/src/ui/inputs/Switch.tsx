import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/Tweaks';

/** 入/切のつまみ（元の Web 版の Toggle: 幅 42・高さ 24、入はアクセント色） */
export function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onChange} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={[styles.track, { backgroundColor: on ? accent.primary : theme.surface2 }]}>
      <View style={[styles.knob, { left: on ? 20 : 2 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 42, height: 24, borderRadius: 999 },
  knob: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
});
