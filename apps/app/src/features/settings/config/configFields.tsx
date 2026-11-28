import type { MsgKey } from '@tstag/core';
import { SECRET_MASK, moveItem } from '@tstag/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { ConfigEditorState, TestBody } from './useConfigEditor';
import { oklch } from '../../../ui/theme/oklch';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

export const CONFIG_RED = oklch(0.6, 0.22, 25);
export const CONFIG_ERR = oklch(0.55, 0.25, 25);
/** オン・オフの選択肢（名前は表示言語の辞書のキー） */
const BOOL: [string, MsgKey][] = [['false', 'settings.configFields.off'], ['true', 'common.on']];
const gb = (b?: number) => (b == null ? '?' : (b / 1024 ** 3).toFixed(1));

/** 小さいボタン（生成・接続テスト・コピー） */
export function SmallBtn({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.smallBtn, { backgroundColor: theme.surface2, borderColor: theme.line, opacity: disabled ? 0.5 : 1 }]}>
      <T mono size={9} w={700}>{children}</T>
    </Pressable>
  );
}

/** 項目の名前。hint はその下に出す短い説明。設定の名前（en）は詳細設定を出している時だけ */
export function Label({ c, label, en, hint }: { c: ConfigEditorState; label: string; en: string; hint?: string }) {
  return (
    <View style={styles.rowLabel}>
      <T size={11} w={700}>{label}</T>
      {!!hint && <T size={9} dim style={styles.hint}>{hint}</T>}
      {c.detail && <T mono size={8} dim>{en}</T>}
    </View>
  );
}

/** 設定の1行（文字・数・選ぶ）。変えた項目は枠を強調する */
export function ConfigRow({ c, label, en, k, type, options, placeholder, hint, fallback }: {
  c: ConfigEditorState; label: string; en: string; k: string; type?: 'number' | 'select' | 'bool'; options?: [string, string][]; placeholder?: string; hint?: string;
  /** 書いていない時にサーバーが使う値（選ぶ欄が空にならないよう、それを選んだ形で出す） */
  fallback?: string;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const select = type === 'select' || type === 'bool';
  return (
    <View style={[styles.row, { borderBottomColor: theme.line }]}>
      <Label c={c} label={label} en={en} hint={hint} />
      <View style={styles.grow}>
        {select ? (
          <Select label={label} value={c.val(k) === '' && fallback != null ? fallback : String(c.val(k))} options={(type === 'bool' ? BOOL.map(([v, l]) => [v, tx(l)] as [string, string]) : options ?? []).map(([value, l]) => ({ value, label: l }))} onChange={(v) => c.set(k, v)} />
        ) : (
          <TextInput value={String(c.val(k) ?? '')} onChangeText={(v) => c.set(k, v)} placeholder={placeholder} placeholderTextColor={theme.mute}
            keyboardType={type === 'number' ? 'numeric' : 'default'} autoCapitalize="none" autoCorrect={false}
            style={[styles.input, { backgroundColor: theme.surface2, color: theme.ink, borderColor: k in c.dirty ? accent.primary : theme.line }]} />
        )}
      </View>
    </View>
  );
}

/** 秘密の値（伏せて出す。変える時だけ入力するか生成する） */
export function SecretRow({ c, label, en, k, hint }: { c: ConfigEditorState; label: string; en: string; k: string; hint?: string }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const v = c.val(k);
  const masked = v === SECRET_MASK && !(k in c.dirty);
  return (
    <View style={[styles.row, { borderBottomColor: theme.line }]}>
      <Label c={c} label={label} en={en} hint={hint} />
      <TextInput value={masked ? '' : String(v ?? '')} onChangeText={(x) => c.set(k, x)} placeholder={masked ? tx('settings.configFields.setEnterGenerateOnly') : tx('settings.configFields.notSet')}
        placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false}
        style={[styles.input, styles.grow, styles.small, { backgroundColor: theme.surface2, color: theme.ink, borderColor: k in c.dirty ? accent.primary : theme.line }]} />
      <SmallBtn onPress={() => void c.generate(k)} disabled={c.secretBusy[k]}>{c.secretBusy[k] ? tx('settings.configFields.generating') : tx('settings.configFields.generate')}</SmallBtn>
    </View>
  );
}

/** 接続テストのボタンと結果 */
export function TestButton({ c, k, body }: { c: ConfigEditorState; k: string; body: TestBody }) {
  const { accent } = useTheme();
  const { t: tx } = useT();
  const t = c.tests[k];
  return (
    <View style={styles.test}>
      <SmallBtn onPress={() => c.test(k, body)} disabled={t?.status === 'running' || !body.url}>{tx(t?.status === 'running' ? 'settings.general.testing' : 'settings.general.test')}</SmallBtn>
      {t && t.status !== 'running' && <T mono size={9} w={700} color={t.status === 'ok' ? accent.quaternary : CONFIG_RED} style={styles.shrink}>{`${t.status === 'ok' ? '✓' : '✗'} ${t.msg ?? ''}`}</T>}
    </View>
  );
}

/** 置き場所の並び（空き・未マウントを出す。ordered は使う順で、上下に動かせる） */
export function PathList({ c, list, setList, placeholder = '/mnt/...', ordered = false }: {
  c: ConfigEditorState; list: string[]; setList: (l: string[]) => void; placeholder?: string; ordered?: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const arrow = (idx: number, d: -1 | 1, label: string, off: boolean) => (
    <Pressable onPress={() => setList(moveItem(list, idx, d))} disabled={off}><T mono size={9} w={700} color={off ? theme.line : theme.ink}>{label}</T></Pressable>
  );
  return (
    <View>
      {list.map((p, idx) => {
        const st = c.disk[p];
        return (
          <View key={idx} style={styles.pathRow}>
            {ordered && <T mono size={9} dim style={styles.no}>{String(idx + 1)}</T>}
            <TextInput value={p} onChangeText={(v) => setList(list.map((x, i) => (i === idx ? v : x)))} placeholder={placeholder} placeholderTextColor={theme.mute}
              autoCapitalize="none" autoCorrect={false} style={[styles.input, styles.small, styles.grow, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }]} />
            {st && (
              <View style={[styles.disk, { backgroundColor: st.mounted ? 'rgba(80,190,110,0.2)' : 'rgba(220,60,60,0.2)' }]}>
                <T mono size={8} w={700} color={st.mounted ? oklch(0.5, 0.18, 145) : oklch(0.55, 0.22, 25)}>{st.mounted ? `${gb(st.free)}/${gb(st.total)}GB` : tx('common.notMounted')}</T>
              </View>
            )}
            {ordered && arrow(idx, -1, '↑', idx === 0)}
            {ordered && arrow(idx, 1, '↓', idx === list.length - 1)}
            <Pressable onPress={() => setList(list.filter((_, i) => i !== idx))}><T mono size={9} w={700} color={CONFIG_RED}>{tx('reservations.list.sheet.delete')}</T></Pressable>
          </View>
        );
      })}
      <View style={styles.pathBtns}>
        <Pressable onPress={() => setList([...list, ''])} style={[styles.pathBtn, { borderColor: theme.line }]}><T mono size={10} w={700} color={accent.primary}>{tx('common.add')}</T></Pressable>
        <Pressable onPress={() => void c.refreshDisk()} disabled={c.diskLoading} style={[styles.pathBtn, { borderColor: theme.line }]}><T mono size={10} w={700}>{c.diskLoading ? tx('settings.configFields.checking') : tx('settings.configFields.checkStatus')}</T></Pressable>
      </View>
    </View>
  );
}

/** 設定の区切りの中の並び・余白 */
export const configStyles = StyleSheet.create({
  pad: { paddingVertical: 8, paddingHorizontal: 13 },
  bb: { borderBottomWidth: 1 },
  bt: { borderTopWidth: 1 },
  gap8: { gap: 8 },
  mb2: { marginBottom: 2 },
  mb4: { marginBottom: 4 },
  mb6: { marginBottom: 6 },
  mt6: { marginTop: 6 },
  lh: { lineHeight: 13 },
  wide: { padding: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 13, borderBottomWidth: 1 },
  rowLabel: { width: 150 },
  hint: { marginTop: 1, lineHeight: 12 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  input: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[500] },
  small: { fontSize: 10 },
  test: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  smallBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start' },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  no: { width: 14, textAlign: 'right' },
  disk: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  pathBtns: { flexDirection: 'row', gap: 8, marginTop: 6 },
  pathBtn: { flex: 1, padding: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
