import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { useT } from '../i18n/I18n';

/** シートの下の「閉じる」と実行のボタン。busy の間は閉じられない。wide: 実行のボタンを倍の幅にする */
export function SheetButtons({ onClose, onSubmit, busy, canSubmit, label, wide }: {
  onClose: () => void; onSubmit: () => void; busy: boolean; canSubmit: boolean; label: string; wide?: boolean;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  return (
    <View style={styles.btns}>
      <Pressable onPress={onClose} disabled={busy} style={[styles.close, { borderColor: theme.line }]}><T mono size={12} w={700} dim>{tx('common.close')}</T></Pressable>
      <Pressable onPress={onSubmit} disabled={!canSubmit} style={[styles.submit, wide && styles.wide, { backgroundColor: canSubmit ? accent.primary : theme.line }]}>
        <T mono size={12} w={800} color="#fff">{label}</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  close: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  submit: { flex: 1, padding: 12, borderRadius: 12, alignItems: 'center' },
  wide: { flex: 2 },
});
