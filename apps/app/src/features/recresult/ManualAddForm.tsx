import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { HistoryInput } from '../../ui/inputs/HistoryInput';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** TS ファイルの手動登録（元の recresult.jsx の手動追加フォーム）。パスは見ているサーバーから見えるもの */
export function ManualAddForm({ node, onClose, onAdded }: { node: string | null; onClose: () => void; onAdded: () => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const api = useApi();
  const [path, setPath] = useState('');
  const [status, setStatus] = useState<'saving' | 'error' | null>(null);
  const v = path.trim();
  const add = async () => {
    if (!v) return;
    setStatus('saving');
    try {
      await api.recordings.addManual(v, node);
      onAdded();
    } catch {
      setStatus('error');
    }
  };
  return (
    <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
      <T mono size={10} w={800} style={styles.mb10}>{tx('recresult.rec.manualAdd')}</T>
      <T mono size={9} dim style={styles.mb4}>TS PATH *</T>
      <View style={styles.mb8}>
        <HistoryInput histKey="ts_path" value={path} onChangeText={setPath} onSubmit={() => void add()} placeholder="/mnt/rec/example.ts"
          style={[styles.input, { borderColor: path ? theme.ink : theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
      </View>
      <View style={styles.row}>
        <Pressable onPress={() => void add()} disabled={!v || status === 'saving'}
          style={[styles.btn, styles.grow, { backgroundColor: v ? accent.primary : theme.surface2, borderColor: theme.frame, opacity: status === 'saving' ? 0.6 : 1 }]}>
          <T mono size={11} w={800} color="#fff">{status === 'saving' ? tx('common.registering2') : status === 'error' ? tx('recresult.manualAddForm.error') : tx('common.register')}</T>
        </Pressable>
        <Pressable onPress={onClose} style={[styles.btn, styles.cancel, { borderColor: theme.line }]}>
          <T size={11} w={700} dim>{tx('common.cancel')}</T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 18, marginBottom: 14, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  mb10: { marginBottom: 10 },
  mb8: { marginBottom: 8 },
  mb4: { marginBottom: 4 },
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  row: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  btn: { padding: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  cancel: { paddingHorizontal: 14 },
});
