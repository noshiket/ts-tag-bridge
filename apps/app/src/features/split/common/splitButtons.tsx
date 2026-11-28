import { fmtMs } from '@tstag/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 分割の画面とタブで使う小さいボタン */
export function Btn({ children, onPress, bg, fg, border, style }: { children: ReactNode; onPress: () => void; bg?: string; fg?: string; border?: string; style?: object }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.btn, { backgroundColor: bg ?? theme.surface2, borderColor: border ?? theme.line }, style]}>
      <T mono size={9} w={800} color={fg ?? theme.ink} style={styles.center}>{children}</T>
    </Pressable>
  );
}

/** 状態の札（AUTO・話数・SKIP など） */
export function Tag({ children, bg, fg, border }: { children: string; bg: string; fg: string; border?: string }) {
  return <View style={[styles.tag, { backgroundColor: bg, borderColor: border ?? 'transparent' }]}><T mono size={9} w={800} color={fg}>{children}</T></View>;
}

/** IN / OUT の1行（元の split.jsx の TimeRow）: コマ送り・秒送り・その位置へ・編集点で上書き */
export function TimeRow({ label, t, efn, frame, onNudge, onJump, onSet }: {
  label: 'IN' | 'OUT'; t: number; efn: (t: number) => number; frame: number; onNudge: (d: number) => void; onJump: () => void; onSet: () => void;
}) {
  const { theme, accent } = useTheme();
  return (
    <View style={styles.row}>
      <Tag bg={label === 'IN' ? accent.tertiary : accent.secondary} fg="#fff" border={theme.ink}>{label}</Tag>
      <Btn onPress={() => onNudge(-frame)} style={styles.nudge}>◀F</Btn>
      <Btn onPress={() => onNudge(-1)} style={styles.nudge}>−1s</Btn>
      <View style={[styles.time, { backgroundColor: theme.ink }]}><T mono size={11} w={800} color={theme.onInk}>{`${fmtMs(t)} #${efn(t)}`}</T></View>
      <Btn onPress={() => onNudge(1)} style={styles.nudge}>+1s</Btn>
      <Btn onPress={() => onNudge(frame)} style={styles.nudge}>F▶</Btn>
      <Btn onPress={onJump} bg={theme.surface} style={styles.nudge}>↵</Btn>
      <Btn onPress={onSet} bg={accent.primary} fg="#fff" border={theme.ink}>←PH</Btn>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  center: { textAlign: 'center' },
  tag: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
  nudge: { width: 28, height: 24, paddingHorizontal: 0, justifyContent: 'center' },
  time: { flex: 1, minWidth: 90, paddingVertical: 4, paddingHorizontal: 7, borderRadius: 6, alignItems: 'center' },
  btn: { paddingVertical: 4, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1 },
});
