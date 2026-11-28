import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { PLAYER_KEY_HELP, type PlayerKeyHandlers } from './playerKeys';
import { useT } from '../../ui/i18n/I18n';

/** キー操作の一覧（元の PlayerShortcutHelp）。全画面でも出るよう映像の上に置く。その画面で使えるものだけ出す */
export function PlayerShortcutHelp({ open, onClose, handlers }: { open: boolean; onClose: () => void; handlers: PlayerKeyHandlers }) {
  const { t: tx } = useT();
  if (!open) return null;
  const items = PLAYER_KEY_HELP.filter((x) => !x.need || typeof handlers[x.need] === 'function');
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scroll}>
        <Pressable style={styles.box} onPress={() => {}}>
          <View style={styles.head}>
            <T mono size={12} w={800} color="#fff">{tx('player.playerShortcutHelp.keyboardRemoteControls')}</T>
            <Pressable onPress={onClose} accessibilityLabel={tx('common.close')}><T size={16} color="rgba(255,255,255,0.7)">✕</T></Pressable>
          </View>
          {items.map((x, i) => (
            <View key={x.label} style={[styles.row, i > 0 && styles.sep]}>
              <View style={styles.keys}>
                {x.keys.map((k) => { const name = typeof k === 'string' ? k : tx(k.t); return <View key={name} style={styles.kbd}><T mono size={10} color="#fff">{name}</T></View>; })}
              </View>
              <T size={11} color="rgba(255,255,255,0.85)" style={styles.flex}>{tx(x.label)}</T>
            </View>
          ))}
        </Pressable>
      </ScrollView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 60, backgroundColor: 'rgba(0,0,0,0.72)' },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  box: { maxWidth: 460, width: '100%', backgroundColor: 'rgba(20,20,24,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  sep: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  keys: { flexDirection: 'row', gap: 4, minWidth: 118 },
  kbd: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 },
  flex: { flex: 1 },
});
