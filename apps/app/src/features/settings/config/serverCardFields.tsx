import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PairRows } from './choiceFields';
import { CONFIG_RED } from './configFields';
import { useViewNode } from '../../../lib/state/viewNode';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

// EDCB・Amatsukaze のカードの中の、JSON で書かせていた項目を、行で書く・選ぶ形にした部品

type Volume = { host?: string; target?: string };
type Encode = { encode_type?: string; name?: string };
type Preset = { name?: string; input_ts?: string; outputs?: { dstPath?: string; profile?: string; priority?: number }; mode?: string; add_queue_bat?: string };

/** 開け閉めできる「細かい指定」 */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fold}>
      <Pressable onPress={() => setOpen(!open)}><T size={10} w={700} dim>{`${open ? '▼' : '▶'} ${title}`}</T></Pressable>
      {open && <View style={styles.foldBody}>{children}</View>}
    </View>
  );
}

/** 場所の対応（機械の場所 ↔ そのサーバーから見た場所） */
export function VolumeRows({ value, onChange, who }: { value: unknown; onChange: (v: Volume[]) => void; who: string }) {
  const { t: tx } = useT();
  const rows = ((Array.isArray(value) ? value : []) as Volume[]).map((v): [string, string] => [v.host ?? '', v.target ?? '']);
  return (
    <View>
      <T size={10} w={700}>{tx('common.pathMapping')}</T>
      <T size={9} dim style={styles.mb4}>{tx('settings.serverCardFields.onlyWhenRunsDocker', { v0: who })}</T>
      <PairRows rows={rows} onChange={(r) => onChange(r.map(([host, target]) => ({ host, target })))} clean={(r) => r.filter(([h, t]) => h || t)}
        left={tx('settings.federation.thisHost')} right={tx('settings.serverCardFields.pathSeen', { v0: who })} sep="↔" changed={false} />
    </View>
  );
}

/** EDCB の録画を、どの Amatsukaze でエンコードするか（Amatsukaze のカードの名前から選ぶ。ほかの種類の指定は残す） */
export function EncoderChoice({ value, onChange, servers }: { value: unknown; onChange: (v: Encode[]) => void; servers: string[] }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const list = (Array.isArray(value) ? value : []) as Encode[];
  const on = (n: string) => list.some((e) => e.encode_type === 'amatsukaze_servers' && e.name === n);
  const toggle = (n: string) => onChange(on(n)
    ? list.filter((e) => !(e.encode_type === 'amatsukaze_servers' && e.name === n))
    : [...list, { encode_type: 'amatsukaze_servers', name: n }]);
  return (
    <View>
      <T size={10} w={700}>{tx('settings.serverCardFields.amatsukazeEncode')}</T>
      <T size={9} dim style={styles.mb4}>{tx('settings.serverCardFields.whereSRecordingsEncoded')}</T>
      <View style={styles.chips}>
        {servers.filter(Boolean).map((n) => (
          <Pressable key={n} onPress={() => toggle(n)} style={[styles.chip, { borderColor: on(n) ? accent.primary : theme.line, backgroundColor: on(n) ? accent.primary : 'transparent' }]}>
            <T size={10} w={700} color={on(n) ? '#fff' : theme.ink}>{`${on(n) ? '✓ ' : ''}${n}`}</T>
          </Pressable>
        ))}
        {servers.filter(Boolean).length === 0 && <T size={9} dim>{tx('settings.serverCardFields.addAmatsukazeFirst')}</T>}
      </View>
    </View>
  );
}

const PRIORITY: { value: string; label: string }[] = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}${n === 3 ? '（ふつう）' : n === 5 ? '（高い）' : n === 1 ? '（低い）' : ''}` }));

/** エンコードの指定（録画ごとに選ぶ名前と、Amatsukaze のプロファイル・優先度。入力と出力の場所は細かい指定に） */
export function PresetList({ value, onChange, url }: { value: unknown; onChange: (v: Preset[]) => void; url: string }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const api = useApi();
  const { viewNode } = useViewNode();
  const profiles = useQuery({ queryKey: ['amzProfileNames', viewNode ?? '', url], queryFn: () => api.amatsukaze.profileNames(url, viewNode), enabled: !!url, staleTime: 60_000 });
  const list = (Array.isArray(value) ? value : []) as Preset[];
  const put = (i: number, p: Preset) => onChange(list.map((x, j) => (j === i ? p : x)));
  const input = [styles.input, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }];
  const text = (v: string | undefined, set: (s: string) => void, ph: string) => (
    <TextInput value={v ?? ''} onChangeText={set} placeholder={ph} placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false} style={input} />
  );
  // 新しい指定は、今ある1つ目を型にする（入力と出力の場所・モードはたいてい同じ）
  const blank = (): Preset => ({ ...(list[0] ?? { input_ts: '{$tmp_base}/{$tmp_dirs}/cut.ts', mode: 'Test', add_queue_bat: '' }),
    name: '', outputs: { ...(list[0]?.outputs ?? { dstPath: '{$tmp_base}/{$tmp_dirs}/output' }), profile: '', priority: 3 } });
  return (
    <View>
      <T size={10} w={700}>{tx('common.encoding')}</T>
      <T size={9} dim style={styles.mb4}>{tx('settings.serverCardFields.encodeNamesChosenPer')}</T>
      {list.map((p, i) => {
        const names = profiles.data ?? [];
        const prof = p.outputs?.profile ?? '';
        const opts = [...(prof && !names.includes(prof) ? [prof] : []), ...names].map((n) => ({ value: n, label: n }));
        return (
          <View key={i} style={[styles.preset, { borderColor: theme.line }]}>
            <View style={styles.row}>
              <View style={styles.grow}>{text(p.name, (s) => put(i, { ...p, name: s }), tx('settings.serverCardFields.nameEGCmcut'))}</View>
              <Pressable onPress={() => onChange(list.filter((_, j) => j !== i))}><T size={9} w={700} color={CONFIG_RED}>{tx('reservations.list.sheet.delete')}</T></Pressable>
            </View>
            <T size={9} dim>{tx('settings.serverCardFields.profile')}</T>
            {opts.length > 0
              ? <Select label={tx('settings.serverCardFields.profile')} value={prof} options={opts} onChange={(v) => put(i, { ...p, outputs: { ...p.outputs, profile: v } })} />
              : text(prof, (s) => put(i, { ...p, outputs: { ...p.outputs, profile: s } }), profiles.isLoading ? '読み込み中…' : 'Amatsukaze のプロファイル名')}
            <T size={9} dim>{tx('common.priority')}</T>
            <Select label={tx('common.priority')} value={String(p.outputs?.priority ?? 3)} options={PRIORITY} onChange={(v) => put(i, { ...p, outputs: { ...p.outputs, priority: Number(v) } })} />
            <Fold title={tx('settings.serverCardFields.inputOutputPaths')}>
              <T size={9} dim>{tx('settings.serverCardFields.inputTs')}</T>
              {text(p.input_ts, (s) => put(i, { ...p, input_ts: s }), '{$tmp_base}/{$tmp_dirs}/cut.ts')}
              <T size={9} dim>{tx('settings.serverCardFields.output')}</T>
              {text(p.outputs?.dstPath, (s) => put(i, { ...p, outputs: { ...p.outputs, dstPath: s } }), '{$tmp_base}/{$tmp_dirs}/output')}
            </Fold>
          </View>
        );
      })}
      <Pressable onPress={() => onChange([...list, blank()])} style={[styles.add, { borderColor: theme.line }]}><T size={10} w={700} color={accent.primary}>{tx('settings.serverCardFields.add')}</T></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fold: { marginTop: 8 },
  foldBody: { gap: 4, marginTop: 6 },
  mb4: { marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  preset: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 4, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  input: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[500] },
  add: { padding: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
