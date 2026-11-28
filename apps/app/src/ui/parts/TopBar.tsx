import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { brutal, shadow } from '../theme/edge';
import { Chev } from './Icons';
import { T } from './T';
import { useTheme } from '../theme/Tweaks';

/** 画面上部の見出し（元の shared.jsx の TopBar）。左は「TS」の印か戻るボタン */
export function TopBar({ title, onBack, right, afterTitle }: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  /** 見出しのすぐ右に置くもの（サーバーの切り替えなど） */
  afterTitle?: ReactNode;
}) {
  const { theme, accent } = useTheme();
  return (
    <View style={styles.bar}>
      {onBack ? (
        <Pressable onPress={onBack} style={[styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: shadow(theme, 2) }]}>
          <Chev d="left" c={theme.ink} />
        </Pressable>
      ) : (
        <View style={[styles.badge, { backgroundColor: accent.primary }, brutal(theme, 2)]}>
          <T mono w={700} size={11} color="#fff">TS</T>
        </View>
      )}
      <View style={[styles.titles, !afterTitle && styles.grow]}>
        <T size={20} w={700} numberOfLines={1} style={styles.title}>{title}</T>
      </View>
      {afterTitle ? <View style={[styles.grow, styles.row]}>{afterTitle}</View> : null}
      {right ? <View>{right}</View> : null}
    </View>
  );
}

export function IconButton({ onPress, children, title }: { onPress: () => void; children: ReactNode; title?: string }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={title}
      style={[styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: shadow(theme, 2) }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4, paddingHorizontal: 18, paddingBottom: 14, minHeight: 50 },
  badge: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titles: { minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { letterSpacing: -0.4, lineHeight: 22 },
});
