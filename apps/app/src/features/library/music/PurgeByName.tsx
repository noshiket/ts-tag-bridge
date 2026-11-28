import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { KeyboardLift } from '../../../ui/sheets/KeyboardLift';
import { useT } from '../../../ui/i18n/I18n';

/** 名前を打って確かめてから消す（アーティスト・アルバムごと削除。元は prompt で名前を打たせていた） */
export function PurgeByName({ open, name, count, onClose, run }: { open: boolean; name: string; count: number; onClose: () => void; run: () => Promise<void> }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = typed.trim() === name && !busy;
  const red = oklch(0.6, 0.22, 25);
  const go = async () => {
    setBusy(true); setErr('');
    try { await run(); } catch (e) { setErr(e instanceof Error ? e.message : tx('common.deleteFailed')); } finally { setBusy(false); }
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardLift>
        <Pressable style={styles.backdrop} onPress={() => { if (!busy) onClose(); }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[styles.dialog, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
            <T size={12} w={800} color={red}>{tx('library.purgeByName.deleteTracksIncludingFiles', { v0: name, v1: count })}</T>
            <T mono size={10} dim style={styles.mt6}>{tx('library.purgeByName.typeNameConfirm')}</T>
            <TextInput value={typed} onChangeText={setTyped} placeholder={name} placeholderTextColor={theme.mute} autoCorrect={false}
              style={[styles.input, styles.mt6, { borderColor: ok ? red : theme.line, backgroundColor: theme.bg, color: theme.ink }]} />
            {!!err && <T size={11} color={red} style={styles.mt6}>{err}</T>}
            <View style={styles.btns}>
              <Pressable onPress={onClose} disabled={busy} style={[styles.btn, { borderColor: theme.line }]}><T mono size={12} w={700} dim>{tx('common.cancel')}</T></Pressable>
              <Pressable disabled={!ok} onPress={() => void go()} style={[styles.btn, { backgroundColor: ok ? red : theme.line, borderColor: 'transparent' }]}>
                <T mono size={12} w={800} color="#fff">{busy ? tx('common.deleting2') : tx('library.purgeByName.delete')}</T>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mt6: { marginTop: 6 },
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 16, borderWidth: 1.5, padding: 18 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
});
