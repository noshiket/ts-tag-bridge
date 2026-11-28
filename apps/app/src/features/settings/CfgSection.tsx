import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chev } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';

/** 開け閉めできる設定のまとまり（元の CfgSection） */
export function CfgSection({ title, note, defaultOpen = false, children }: { title: string; note?: string; defaultOpen?: boolean; children: ReactNode }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const fg = open ? theme.onInk : theme.ink;
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen(!open)} style={[styles.head, open ? styles.headOpen : styles.headClosed, {
        backgroundColor: open ? theme.ink : theme.surface2, borderColor: theme.frame,
      }]}>
        <T mono size={11} w={800} color={fg} style={styles.grow}>
          {title}{note ? <T mono size={9} w={500} color={open ? theme.onInk : theme.mute}>{`  ${note}`}</T> : null}
        </T>
        <Chev s={11} c={open ? theme.onInk : theme.mute} d={open ? 'down' : 'right'} />
      </Pressable>
      {open && <View style={[styles.body, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1.5 },
  headOpen: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  headClosed: { borderRadius: 12 },
  grow: { flex: 1 },
  body: { borderWidth: 1.5, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: 'hidden' },
});
