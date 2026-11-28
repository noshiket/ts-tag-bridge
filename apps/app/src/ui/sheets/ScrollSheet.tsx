import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/Tweaks';
import { KeyboardLift } from './KeyboardLift';

/**
 * 下から出る、中が縦に流れるシート（入力の多い追加・修正・削除の確認など）。
 * busy の間は外を押しても閉じない。tall: 少し高くする（88%）。after: 流れる所の外（シートの中）に置くもの
 */
export function ScrollSheet({ open, onClose, busy = false, tall, after, children }: {
  open: boolean; onClose: () => void; busy?: boolean; tall?: boolean; after?: ReactNode; children: ReactNode;
}) {
  const { theme } = useTheme();
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardLift>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[styles.sheet, tall && styles.tall, { backgroundColor: theme.surface, borderTopColor: theme.ink }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.grip, { backgroundColor: theme.mute }]} />
              {children}
            </ScrollView>
            {after}
          </Pressable>
        </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1.5, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 32 },
  tall: { maxHeight: '88%' },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, opacity: 0.5 },
});
