import { Pressable, StyleSheet, View } from 'react-native';

import { Chev } from '../parts/Icons';
import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { useT } from '../i18n/I18n';
import { shadow } from '../theme/edge';

/** 「絞込」の開け閉め。選んでいる数を添える（元の Web 版のボタン） */
export function FilterToggle({ open, count, onPress, label, size = 9 }: {
  open: boolean;
  count: number;
  onPress: () => void;
  label?: string;
  size?: number;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const fg = open ? theme.onInk : theme.ink;
  return (
    <Pressable onPress={onPress} style={[styles.btn, { backgroundColor: open ? theme.ink : theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
      <T mono w={800} size={size} color={fg}>{label ?? tx('common.filter')}</T>
      {count > 0 && (
        <View style={[styles.badge, { backgroundColor: open ? theme.onInk : theme.ink }]}>
          <T mono w={800} size={8} color={open ? theme.ink : theme.onInk}>{count}</T>
        </View>
      )}
      <Chev s={9} c={fg} d={open ? 'down' : 'right'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.5 },
  badge: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4 },
});
