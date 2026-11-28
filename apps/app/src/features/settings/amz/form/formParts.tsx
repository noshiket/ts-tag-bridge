import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Select } from '../../../../ui/inputs/Select';
import { T } from '../../../../ui/parts/T';
import { monoFamily } from '../../../../ui/theme/theme';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { shadow as edgeShadow } from '../../../../ui/theme/edge';

/** プロファイル編集の部品: 見出し付きのまとまり・ラベル・横並び・選択・数値・ボタン */
export function Group({ title, gap = 8, children }: { title: string; gap?: number; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap }}>
      <T mono size={9} dim style={[styles.sec, { borderBottomColor: theme.line }]}>{title}</T>
      {children}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <T mono size={9} dim style={styles.label}>{children}</T>;
}

export function Cols({ children }: { children: ReactNode }) {
  return <View style={styles.cols}>{(Array.isArray(children) ? children : [children]).filter(Boolean).map((c, i) => <View key={i} style={styles.col}>{c}</View>)}</View>;
}

export function Sel({ label, value, opts, onChange }: { label: string; value: string; opts: string[]; onChange: (v: string) => void }) {
  return (
    <View>
      <Label>{label}</Label>
      <Select label={label} value={value} options={opts.map((o) => ({ value: o, label: o }))} onChange={onChange} />
    </View>
  );
}

export function NumBox({ value, onChange, float }: { value: number; onChange: (v: number) => void; float?: boolean }) {
  const { theme } = useTheme();
  // 打っている途中（'0.' など）を崩さないよう、文字のまま持つ
  const [text, setText] = useState(String(value ?? ''));
  return (
    <TextInput value={text} keyboardType={float ? 'decimal-pad' : 'number-pad'}
      onChangeText={(v) => { setText(v); const n = float ? parseFloat(v) : parseInt(v, 10); onChange(Number.isFinite(n) ? n : 0); }}
      style={[formStyles.input, styles.num, { borderColor: theme.line, backgroundColor: theme.surface, color: theme.ink }]} />
  );
}

export function Num({ label, value, onChange, float }: { label: string; value: number | undefined; onChange: (v: number) => void; float?: boolean }) {
  return <View><Label>{label}</Label><NumBox value={value ?? 0} onChange={onChange} float={float} /></View>;
}

export function Btn({ children, flex, bg, fg, shadow, disabled, onPress }: { children: string; flex: number; bg: string; fg: string; shadow?: boolean; disabled?: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, { flex, backgroundColor: bg, borderColor: theme.frame, boxShadow: shadow ? edgeShadow(theme, 2) : 'none' }]}>
      <T mono size={12} w={800} color={fg}>{children}</T>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  input: { paddingVertical: 7, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  area3: { minHeight: 60, textAlignVertical: 'top' },
  area2: { minHeight: 44, textAlignVertical: 'top' },
  indent: { marginTop: 6, marginLeft: 20 },
  btns: { flexDirection: 'row', gap: 8 },
});

const styles = StyleSheet.create({
  sec: { paddingBottom: 3, borderBottomWidth: 1, letterSpacing: 1 },
  label: { marginBottom: 3 },
  num: { paddingVertical: 6, paddingHorizontal: 8, minWidth: 56 },
  cols: { flexDirection: 'row', gap: 8 },
  col: { flex: 1, minWidth: 0 },
  btn: { padding: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
});
