import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ParamLabel, actionStyles as st, useInputStyle } from './actionUi';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 出力フィールドの名前を選ぶ欄（候補から選ぶか自由に入れる）。入力中は部分一致で絞り、今の値と一致していれば全部出す */
export function FieldRefInput({ label, desc, value, fields, onChange }: {
  label: string; desc?: string; value: string; fields: string[]; onChange: (v: string) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const input = useInputStyle();
  const [open, setOpen] = useState(false);
  const q = value.toLowerCase();
  const cands = !q || fields.includes(value) ? fields : fields.filter((f) => f.toLowerCase().includes(q));
  return (
    <View>
      <ParamLabel text={label} desc={desc} />
      <View style={st.row}>
        <TextInput value={value} placeholder={tx('patterns.fieldRefInput.chooseFieldTypeFreely')} placeholderTextColor={theme.mute}
          onChangeText={(v) => { onChange(v); setOpen(true); }} onFocus={() => setOpen(true)}
          style={[...input, st.grow, styles.leftHalf]} />
        <Pressable onPress={() => setOpen((o) => !o)} style={[styles.drop, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
          <T size={9} dim>▼</T>
        </Pressable>
      </View>
      {open && cands.length > 0 && (
        <View style={[styles.cands, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
          {cands.map((f) => (
            <Pressable key={f} onPress={() => { onChange(f); setOpen(false); }} style={[styles.cand, f === value && { backgroundColor: theme.surface2 }]}>
              <T mono size={10} color={f === value ? accent.primary : theme.ink}>{f}</T>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  leftHalf: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  drop: { paddingHorizontal: 8, justifyContent: 'center', borderWidth: 1.5, borderLeftWidth: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  cands: { marginTop: 2, maxHeight: 180, borderWidth: 1.5, borderRadius: 6, overflow: 'hidden' },
  cand: { paddingVertical: 5, paddingHorizontal: 8 },
});
