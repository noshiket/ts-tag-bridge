import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { editorStyles as es } from '../common/editorUi';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 番組情報（CONTEXT）の1行。長い値は1行に畳み、▼で開く */
export function ProgramContextRow({ label, value, pre }: { label: string; value: string; pre?: boolean }) {
  const { theme, accent } = useTheme();
  const [open, setOpen] = useState(false);
  if (!value) return null;
  const long = value.length > 80 || (!!pre && value.includes('\n'));
  return (
    <View style={[styles.row, { borderTopColor: theme.line }]}>
      <T mono size={9} color={accent.primary} style={styles.label}>{label}</T>
      {/* 畳んでいる間は1行に切る（切った文字は範囲で選べないので、開いた時だけ範囲で選べる） */}
      <T range={!long || open} size={10} numberOfLines={long && !open ? 1 : undefined} style={es.grow}>{value}</T>
      {long && <Pressable onPress={() => setOpen((o) => !o)}><T size={9} dim>{open ? '▲' : '▼'}</T></Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4, borderTopWidth: 1 },
  label: { width: 90, paddingTop: 2, letterSpacing: 0.3 },
});
