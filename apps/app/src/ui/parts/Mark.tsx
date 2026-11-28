import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/Tweaks';

/**
 * 色の付いた札（状態・重複・設定の印など）。テーマの marks に従う:
 * fill は色で塗る（元の Web 版）、quiet は塗らずに色の点と文字だけにして、色はサムネイルに譲る。
 * urgent（録画中・エラーなど、すぐ気づきたいもの）と、色の無い札（面の色・文字の色で塗ったもの）は quiet でも塗る。
 * children には文字の色を渡す（<Mark bg={c} fg="#fff">{(fg) => <T color={fg}>…</T>}</Mark>）
 */
export function Mark({ bg, fg, urgent, style, children }: {
  bg: string;
  fg: string;
  urgent?: boolean;
  style?: StyleProp<ViewStyle>;
  children: (fg: string) => ReactNode;
}) {
  const { theme } = useTheme();
  const plain = bg === theme.surface2 || bg === theme.surface || bg === theme.ink;
  if (theme.marks === 'fill' || urgent || plain) return <View style={[style, { backgroundColor: bg }]}>{children(fg)}</View>;
  return (
    <View style={[style, styles.quiet, { borderColor: theme.line }]}>
      <View style={[styles.dot, { backgroundColor: bg }]} />
      {children(theme.ink)}
    </View>
  );
}

const styles = StyleSheet.create({
  quiet: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'transparent', borderWidth: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
