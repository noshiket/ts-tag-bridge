import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { oklch } from '../theme/oklch';
import { T } from './T';

/** 操作の結果の知らせ（成功は緑、失敗は赤）。msg が無ければ出さない。間隔は style で */
export function ResultMessage({ msg, style }: { msg: { ok: boolean; text: string } | null | undefined; style?: StyleProp<ViewStyle> }) {
  if (!msg) return null;
  return (
    <View style={[styles.box, { backgroundColor: msg.ok ? oklch(0.94, 0.05, 150) : oklch(0.92, 0.06, 25) }, style]}>
      <T mono size={11} color={msg.ok ? oklch(0.4, 0.15, 150) : oklch(0.4, 0.22, 25)}>{msg.text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 },
});
