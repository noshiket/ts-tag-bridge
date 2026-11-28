import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';

/** 録画のエンコード設定の1欄（見出しと中身） */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><T size={10} dim style={styles.label}>{label}</T>{children}</View>;
}

/** 選択肢がある時は空の「選択」を出さない（空のまま残さない）。無い時だけ出す */
export const withBlank = (opts: { value: string; label: string }[], blank: string) => (opts.length ? opts : [{ value: '', label: blank }]);

const styles = StyleSheet.create({
  field: { marginBottom: 8 },
  label: { marginBottom: 3 },
});
