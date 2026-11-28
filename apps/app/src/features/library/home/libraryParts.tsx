import { StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';

/** ライブラリの空・読み込み中の一言 */
export function Empty({ children }: { children: string }) {
  return <T size={12} dim style={styles.empty}>{children}</T>;
}

/** 読めなかった時の枠 */
export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={[styles.error, { backgroundColor: errorBox.bg, borderColor: errorBox.border }]}>
      <T mono size={11} color={errorBox.text}>{message}</T>
    </View>
  );
}

export const libraryStyles = StyleSheet.create({
  list: { paddingHorizontal: 18, gap: 8 },
});

const styles = StyleSheet.create({
  empty: { textAlign: 'center', padding: 40 },
  error: { marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10 },
});
