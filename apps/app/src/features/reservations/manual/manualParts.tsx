import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';

/** 手動予約の部品: 見出し付きの欄・枠・EDCB 名と既定値付きの行・枠の中の1段・説明 */
export function FormRow({ label, en, children }: { label: string; en: string; children: ReactNode }) {
  return (
    <View>
      <View style={styles.formHead}><T size={12} w={700}>{label}</T><T mono size={9} dim>{en}</T></View>
      {children}
    </View>
  );
}

export function Box({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>{children}</View>;
}

export function Row({ en, ja, def, last, children }: { en: string; ja: string; def: string; last?: boolean; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      <View style={styles.rowLabel}>
        <T mono size={10} w={700}>{en}</T>
        <T size={9} dim>{ja}</T>
        <T mono size={8} dim style={styles.def}>{`def: ${def}`}</T>
      </View>
      <View style={manualStyles.grow}>{children}</View>
    </View>
  );
}

export function Cell({ children, top, last }: { children: ReactNode; top?: boolean; last?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.cell, top && { borderTopWidth: 1, borderTopColor: theme.line }, !top && !last && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      {children}
    </View>
  );
}

export function Hint({ en, rest }: { en: string; rest: string }) {
  return <T mono size={9} dim style={manualStyles.mb4}>{en}<T mono size={9} dim style={styles.def}>{rest}</T></T>;
}

/** 小さい入力欄の形（線と色は呼ぶ側の theme で） */
export function useSmallInput() {
  const { theme } = useTheme();
  return [manualStyles.small, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }];
}

export const manualStyles = StyleSheet.create({
  grow: { flex: 1 },
  mb4: { marginBottom: 4 },
  big: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1.5, fontSize: 13, fontFamily: monoFamily[400] },
  small: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
});

const styles = StyleSheet.create({
  formHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 5 },
  box: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12 },
  rowLabel: { width: 110 },
  def: { opacity: 0.6 },
  cell: { paddingVertical: 9, paddingHorizontal: 12 },
});
