import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Chev } from '../parts/Icons';
import { Sheet, SheetItem } from '../sheets/Sheet';
import { T } from '../parts/T';
import { monoFamily } from '../theme/theme';
import { useTheme } from '../theme/Tweaks';

export type SelectOption<V> = { value: V; label: string };

/**
 * 選択（Web の <select> の代わり）。押すと下から選択肢のシートが出る。
 * 値は == で比べる（EDCB は数の項目に true/false を返すことがあり、1/0 の選択肢と合わせたい）
 */
export function Select<V extends string | number | boolean>({ value, options, onChange, label }: {
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  /** シートの見出し・読み上げ */
  label: string;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line eqeqeq
  const cur = options.find((o) => o.value == value || Number(o.value) === Number(value));
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}
        style={[styles.box, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        <T mono size={11} numberOfLines={1} style={styles.grow}>{cur?.label ?? String(value)}</T>
        <Chev s={10} c={theme.mute} d="down" />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.list}>
          {options.map((o, i) => (
            <SheetItem key={String(o.value)} first={i === 0} label={`${o === cur ? '✓ ' : '　'}${o.label}`}
              onPress={() => { setOpen(false); onChange(o.value); }} />
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1 },
  grow: { flex: 1, fontFamily: monoFamily[400] },
  list: { maxHeight: 420 },
});
