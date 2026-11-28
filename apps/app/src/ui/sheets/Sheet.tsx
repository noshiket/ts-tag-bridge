import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { danger } from '../theme/theme';
import { KeyboardLift } from './KeyboardLift';

/** 下から出る操作の一覧（元の Web 版のアルバム・ビデオカードの「…」） */
export function Sheet({ open, onClose, title, subtitle, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardLift>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[styles.sheet, { backgroundColor: theme.surface, borderTopColor: theme.ink }]}>
            <View style={[styles.grip, { backgroundColor: theme.mute }]} />
            {/* 見出しが空なら出さない（中身の側で大きく出す時など） */}
            {!!title && <T size={13} w={800} numberOfLines={1}>{title}</T>}
            {subtitle ? <T mono size={9} dim style={styles.sub}>{subtitle}</T> : null}
            {children}
          </Pressable>
        </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

export function SheetItem({ label, sub, onPress, danger: isDanger, first }: {
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  first?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.item, !first && { borderTopWidth: 1, borderTopColor: theme.line }]}>
      <T size={12} w={700} color={isDanger ? danger : theme.ink}>{label}</T>
      {sub ? <T mono size={9} dim>{sub}</T> : null}
    </Pressable>
  );
}

/** シートの中の大きな色付きのボタン（スキップ・削除など。下に何が起きるかを小さく添える） */
export function SheetAction({ bg, icon, label, sub, onPress }: { bg: string; icon: ReactNode; label: string; sub: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.action, { backgroundColor: bg, borderColor: theme.frame }]}>
      {icon}
      <View style={styles.actionText}>
        <T size={13} w={800} color="#fff">{label}</T>
        <T mono size={9} color="rgba(255,255,255,0.85)">{sub}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1.5 },
  actionText: { flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1.5, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 32 },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, opacity: 0.5 },
  sub: { marginTop: 2, marginBottom: 12 },
  item: { paddingVertical: 11, paddingHorizontal: 12 },
});
