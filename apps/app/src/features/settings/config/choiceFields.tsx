import { intervalOptions, toolChoice, type ToolChoice } from '@tstag/core';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CONFIG_RED, ConfigRow, Label } from './configFields';
import type { ConfigEditorState } from './useConfigEditor';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** ワーカーの間隔（秒）を候補から選ぶ */
export function IntervalRow({ c, label, k, hint }: { c: ConfigEditorState; label: string; k: string; hint?: string }) {
  return <ConfigRow c={c} label={label} en={k} k={k} type="select" options={intervalOptions(c.val(k))} hint={hint} />;
}

/** ffmpeg・ffprobe の場所: 同梱版・システムの物から選ぶ。どちらでもなければ場所を書く */
export function ToolRow({ c, label, k }: { c: ConfigEditorState; label: string; k: 'ffmpeg' | 'ffprobe' }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const cand = c.tools[k];
  const choice = toolChoice(c.val(k), cand);
  const options: { value: ToolChoice; label: string }[] = [
    ...(cand?.bundled ? [{ value: 'bundled' as const, label: tx('settings.choiceFields.bundledRecommended') }] : []),
    ...(cand?.system ? [{ value: 'system' as const, label: tx('settings.choiceFields.system', { v0: cand.system }) }] : []),
    { value: 'custom', label: tx('settings.choiceFields.specifyPath') },
  ];
  const pick = (v: ToolChoice) => {
    if (v === 'bundled' && cand?.bundled) c.set(k, cand.bundled);
    else if (v === 'system' && cand?.system) c.set(k, cand.system);
    else if (choice !== 'custom') c.set(k, '');
  };
  return (
    <View style={[styles.row, { borderBottomColor: theme.line }]}>
      <Label c={c} label={label} en={k} />
      <View style={styles.grow}>
        <Select label={label} value={choice} options={options} onChange={pick} />
        {choice === 'custom' && (
          <TextInput value={String(c.val(k) ?? '')} onChangeText={(v) => c.set(k, v)} placeholder={`/usr/local/bin/${k}`} placeholderTextColor={theme.mute}
            autoCapitalize="none" autoCorrect={false}
            style={[styles.input, styles.mt4, { backgroundColor: theme.surface2, color: theme.ink, borderColor: k in c.dirty ? accent.primary : theme.line }]} />
        )}
      </View>
    </View>
  );
}

/**
 * 2つ組の行の並び（左右に1つずつ書く）。JSON を手で書かせる代わりに使う
 * （ボリュームの「サーバーの場所 ↔ コンテナから見た場所」、パーサーコンテキストの「名前 = 値」）
 */
export function PairRows({ rows, onChange, clean, left, right, sep, changed }: {
  rows: [string, string][]; onChange: (rows: [string, string][]) => void;
  /** 設定に入れる形へ整える（空の行を捨てる等）。親へはこの形で渡す */
  clean: (rows: [string, string][]) => [string, string][];
  left: string; right: string; sep: string; changed: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  // 書きかけの行（空の行も含む）は画面で持つ。設定の値（空の行は捨てたもの）が外から変わった時だけ置き換える
  const [draft, setDraft] = useState<[string, string][]>(rows);
  const sent = useRef(JSON.stringify(rows));
  const incoming = JSON.stringify(rows);
  useEffect(() => { if (incoming !== sent.current) { setDraft(rows); sent.current = incoming; } }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: [string, string][]) => { setDraft(next); const v = clean(next); sent.current = JSON.stringify(v); onChange(v); };
  const put = (i: number, j: 0 | 1, v: string) => update(draft.map((r, x) => (x === i ? (j === 0 ? [v, r[1]] : [r[0], v]) : r)));
  const input = (i: number, j: 0 | 1, ph: string) => (
    <TextInput value={draft[i]![j]} onChangeText={(v) => put(i, j, v)} placeholder={ph} placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false}
      style={[styles.input, styles.grow, { backgroundColor: theme.surface2, color: theme.ink, borderColor: changed ? accent.primary : theme.line }]} />
  );
  return (
    <View>
      {draft.map((_, i) => (
        <View key={i} style={styles.pair}>
          {input(i, 0, left)}
          <T mono size={10} dim>{sep}</T>
          {input(i, 1, right)}
          <Pressable onPress={() => update(draft.filter((__, x) => x !== i))}><T mono size={9} w={700} color={CONFIG_RED}>{tx('reservations.list.sheet.delete')}</T></Pressable>
        </View>
      ))}
      <Pressable onPress={() => setDraft([...draft, ['', '']])} style={[styles.add, { borderColor: theme.line }]}>
        <T mono size={10} w={700} color={accent.primary}>{tx('common.add')}</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 13, borderBottomWidth: 1 },
  grow: { flex: 1, minWidth: 0 },
  input: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[500] },
  mt4: { marginTop: 4 },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  add: { padding: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center', marginTop: 6 },
});
