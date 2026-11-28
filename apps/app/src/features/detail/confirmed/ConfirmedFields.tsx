import { CONFIRMED_FIELDS, LIST_SEP, MULTILINE_COLS, splitList } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CONFIRMED_RED, Choice, confirmedStyles as cs } from './confirmedParts';
import type { ConfirmedState } from './useConfirmedValues';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 確定値（直せる）。並びの列（複数話）は1話ずつの欄、自動エンコードは優先度の選択、パス形式は「解決」付き、
 * 出力先のディスク（録画・動画だけ。ルールには列が無い）
 */
export function ConfirmedFields({ s, errText, node, compact, libLink }: {
  s: ConfirmedState; errText: string; node: string | null; compact?: boolean; libLink: (key: string, value: string) => ReactNode;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const { vals, change, lists } = s;
  const options = useQuery({ queryKey: ['encodeOptions', node ?? ''], queryFn: () => api.confirmed.encodeOptions(node), enabled: s.kind !== 'rule' });
  const input = [cs.input, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }];
  const row = (label: string, top: boolean, content: ReactNode, key?: string) => (
    <View key={key ?? label} style={compact ? styles.rowCompact : [styles.row, top && styles.top]}>
      <T mono size={9} w={700} dim style={compact ? undefined : [styles.label, top && styles.labelTop]}>{label}</T>
      {content}
    </View>
  );
  const encodeDirChoices = (): [string, string][] => {
    const dirs = options.data?.encode_dir_list ?? [];
    const peer = options.data?.library_peer_name;
    const cur = vals.encode_dir ?? '';
    // 送る側（library_peer がある）は、出力先を選んでいない新しい録画にサーバーが master を当てる
    return [
      ['', `（デフォルト${peer ? ': master' : dirs[0] ? `: ${dirs[0]}` : ''}）`],
      ...(peer ? [['master', tx('common.masterSend', { v0: peer })] as [string, string]] : []),
      ...dirs.map((d): [string, string] => [d, d]),
      ...(cur && cur !== 'master' && !dirs.includes(cur) ? [[cur, tx('common.notRegistered', { v0: cur })] as [string, string]] : []),
    ];
  };

  return (
    <View style={cs.block}>
      <T mono size={9} w={700} dim style={[cs.ls, styles.mb]}>CONFIRMED VALUES</T>
      <View style={styles.fields}>
        {row('parser_err', true, <T mono size={10} color={errText ? CONFIRMED_RED : theme.mute} style={cs.grow}>{errText || '—'}</T>)}
        {CONFIRMED_FIELDS.map((f) => {
          const multi = MULTILINE_COLS.has(f.key);
          if (f.key === 'auto_send') {
            // 自動エンコード: 0 = なし、1〜5 = その優先度で自動でキューへ（true は 3 として扱う）
            const cur = vals.auto_send === 'true' ? '3' : vals.auto_send === 'false' ? '0' : vals.auto_send ?? '';
            return row(f.label, false, (
              <View style={cs.choices}>
                {[['', '—'], ['0', 'OFF'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']].map(([v, l]) => (
                  <Choice key={l} label={l!} active={cur === v} onPress={() => change(f.key, v!)} />
                ))}
                <T mono size={8} dim style={styles.dim}>{tx('detail.confirmedFields.15Priority')}</T>
              </View>
            ), f.key);
          }
          if (lists.has(f.key)) {
            const parts = splitList(vals[f.key] ?? '');
            const set = (next: string[]) => change(f.key, next.join(LIST_SEP));
            return row(f.label, true, (
              <View style={cs.grow}>
                {parts.map((part, i) => (
                  <View key={i} style={styles.listRow}>
                    <TextInput value={part} placeholder={f.ja} placeholderTextColor={theme.mute} multiline={multi}
                      onChangeText={(v) => set(parts.map((x, j) => (j === i ? v : x)))} style={[input, multi && cs.multi]} />
                    {libLink(f.key, part)}
                    {parts.length > 1 && (
                      <Pressable onPress={() => set(parts.filter((_x, j) => j !== i))} style={[cs.small, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                        <T mono size={11} w={700} dim>−</T>
                      </Pressable>
                    )}
                  </View>
                ))}
                <Pressable onPress={() => set([...parts, ''])} style={[styles.add, { borderColor: theme.line }]}>
                  <T mono size={9} w={700} dim>{tx('common.add')}</T>
                </Pressable>
              </View>
            ), f.key);
          }
          if (f.key === 'app_output_path_format') {
            return row(f.label, true, (
              <>
                <TextInput value={vals[f.key] ?? ''} placeholder={f.ja} placeholderTextColor={theme.mute} multiline
                  onChangeText={(v) => change(f.key, v)} style={[input, cs.multi]} />
                <Pressable onPress={s.resolvePath} disabled={s.resolving || !vals.app_output_path_format}
                  style={[cs.pill, { backgroundColor: s.resolving ? theme.surface2 : accent.secondary }]}>
                  <T mono size={8} w={800} color={s.resolving ? theme.mute : '#fff'}>{s.resolving ? '...' : tx('detail.confirmedFields.resolve')}</T>
                </Pressable>
              </>
            ), f.key);
          }
          return row(f.label, multi, (
            <>
              <TextInput value={vals[f.key] ?? ''} placeholder={f.ja} placeholderTextColor={theme.mute} multiline={multi}
                onChangeText={(v) => change(f.key, v)} style={[input, multi && cs.multi]} />
              {libLink(f.key, vals[f.key] ?? '')}
            </>
          ), f.key);
        })}
        {s.kind !== 'rule' && row('encode_dir', false, (
          <View style={cs.choices}>
            {encodeDirChoices().map(([v, l]) => (
              <Choice key={v || 'default'} label={l} active={(vals.encode_dir ?? '') === v} onPress={() => s.setVals((x) => ({ ...x, encode_dir: v }))} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mb: { marginBottom: 6 },
  fields: { gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  top: { alignItems: 'flex-start' },
  rowCompact: { gap: 3 },
  label: { width: 76, flexShrink: 0 },
  labelTop: { paddingTop: 5 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  add: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed' },
  dim: { opacity: 0.75 },
});
