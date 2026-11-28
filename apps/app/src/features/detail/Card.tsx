import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';

/** 詳細の箱（太い縁と影）。small は説明など中くらいの箱、flat は中身を端まで敷く箱 */
export function Card({ children, small, flat }: { children: ReactNode; small?: boolean; flat?: boolean }) {
  const { theme } = useTheme();
  const shadow = small || flat ? 3 : 4;
  return (
    <View style={[flat ? styles.flat : small ? styles.small : styles.big, {
      backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: `${shadow}px ${shadow}px 0px ${theme.ink}`,
    }]}>{children}</View>
  );
}

/** 見出しの小さな札（番号など） */
export function Tag({ children, bg, fg }: { children: string; bg: string; fg: string }) {
  return <View style={[styles.tag, { backgroundColor: bg }]}><T mono size={9} w={700} color={fg}>{children}</T></View>;
}

const styles = StyleSheet.create({
  big: { borderWidth: 1.5, borderRadius: 20, padding: 14 },
  small: { borderWidth: 1.5, borderRadius: 16, padding: 12 },
  flat: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  tag: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
});
