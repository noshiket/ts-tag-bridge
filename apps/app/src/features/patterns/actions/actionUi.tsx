import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { monoFamily } from '../../../ui/theme/theme';

/** アクションの引数の見出し（説明があれば薄く後ろに） */
export function ParamLabel({ text, desc }: { text: string; desc?: string }) {
  return <T mono size={9} dim style={actionStyles.lbl}>{text}{desc ? <T mono size={8} dim style={actionStyles.desc}>{` — ${desc}`}</T> : null}</T>;
}

/** 差し込む値・選ぶ値の小さいチップ */
export function ParamChip({ label, on, color, onPress }: { label: string; on: boolean; color: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[actionStyles.chip, { backgroundColor: on ? color : theme.surface, borderColor: on ? color : theme.line }]}>
      <T mono size={8} w={700} color={on ? '#fff' : theme.mute}>{label}</T>
    </Pressable>
  );
}

/** 文字の入力欄の見た目 */
export function useInputStyle() {
  const { theme } = useTheme();
  return [actionStyles.input, { borderColor: theme.line, backgroundColor: theme.bg, color: theme.ink }];
}

/** アクションの入力で共通の並び・余白 */
export const actionStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  center: { alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  grow: { flex: 1, minWidth: 0 },
  lbl: { marginBottom: 2, letterSpacing: 0.3 },
  desc: { opacity: 0.7 },
  input: { paddingVertical: 5, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1.5, fontSize: 10, fontFamily: monoFamily[400] },
  chip: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1 },
  autoPat: { marginTop: 4, paddingVertical: 4, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
  mb3: { marginBottom: 3 },
  mb4: { marginBottom: 4 },
  mb6: { marginBottom: 6 },
  mt4: { marginTop: 4 },
  mt6: { marginTop: 6 },
});
