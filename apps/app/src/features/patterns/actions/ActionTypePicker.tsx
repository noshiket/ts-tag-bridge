import type { Action, ActionDef } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { actionStyles as st } from './actionUi';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/**
 * アクションの種類のボタン（押すと種類の一覧が開く）と、その種類の説明。種類を変えると引数は定義の既定値で作り直す。
 * defOf は種類の定義（サーバー優先、無ければ元の定数）
 */
export function ActionTypePicker({ type, schema, picker, defOf, onChange }: {
  type: string; schema: ActionDef; picker: ActionDef[]; defOf: (key: string) => ActionDef | undefined; onChange: (a: Action) => void;
}) {
  const { theme, accent } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={st.grow}>
      <Pressable onPress={() => setOpen((o) => !o)} style={[styles.typeBtn, { backgroundColor: accent.primary, borderColor: accent.primary }]}>
        <T mono size={9} w={700} color="#fff">{`${type} ▾`}</T>
      </Pressable>
      {open && (
        <View style={[styles.picker, { backgroundColor: theme.isDark ? '#1a1520' : '#fff', borderColor: theme.line }]}>
          {picker.map((s) => {
            const on = type === s.key;
            return (
              <Pressable key={s.key} style={[styles.pickRow, on && { backgroundColor: accent.primary }]} onPress={() => {
                const init: Action = { type: s.key };
                defOf(s.key)?.params.forEach((p) => { if (p.default !== undefined) init[p.key] = p.default; });
                onChange(init);
                setOpen(false);
              }}>
                <T mono size={9} w={800} color={on ? '#fff' : theme.ink} style={styles.pickKey}>{s.key}</T>
                <T mono size={8} color={on ? 'rgba(255,255,255,0.7)' : theme.mute} numberOfLines={1} style={st.grow}>{`→ ${s.output_type}`}</T>
              </Pressable>
            );
          })}
        </View>
      )}
      <T mono size={9} color={theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.38)'} style={st.mt4}>{`${schema.label} — ${schema.description}`}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  typeBtn: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1.5 },
  picker: { marginTop: 4, borderWidth: 1.5, borderRadius: 10, padding: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 7, marginBottom: 1 },
  pickKey: { minWidth: 150 },
});
