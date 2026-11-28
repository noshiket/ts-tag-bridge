import { PATH_TEMPLATE_RULES, PATH_VAR_GROUPS, expandPathExample } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * ファイル名の決め方（設定の output_path・パターンの setPath）の下に出す説明: 今の書き方を例の値で展開したものと、
 * 開くと使える変数の一覧（見出しごと: 解析した値・パーサーへ渡す値・保存の時に決まる値）。
 * onInsert を渡すと、変数を押した時に書き方の末尾へ足す。extraFields はアドオン等で増えた出力（一覧に無いもの）
 */
export function PathVarsHelp({ template, onInsert, extraFields = [] }: { template: string; onInsert?: (s: string) => void; extraFields?: string[] }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [open, setOpen] = useState(false);
  const known = new Set(PATH_VAR_GROUPS.flatMap((g) => g.vars.map((v) => v.key)));
  const extra = extraFields.filter((f) => !known.has(f));
  return (
    <View style={styles.box}>
      {!!template.trim() && <T mono size={9} dim selectable>{tx('patterns.pathVarsHelp.eG', { v0: expandPathExample(template) })}</T>}
      <Pressable onPress={() => setOpen(!open)} style={styles.toggle}>
        <T size={10} w={700} color={accent.primary}>{tx('patterns.pathVarsHelp.variablesExamples', { v0: open ? '▼' : '▶' })}</T>
      </Pressable>
      {open && (
        <View style={[styles.body, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          {PATH_VAR_GROUPS.map((g) => (
            <View key={g.title} style={styles.group}>
              <T size={10} w={800}>{g.title}</T>
              <T size={9} dim style={styles.note}>{g.note}</T>
              {g.vars.map((v) => {
                const ref = g.patternOnly ? `$${v.key}` : `{$${v.key}}`;
                return (
                  <Pressable key={ref} disabled={!onInsert || g.patternOnly} onPress={() => onInsert?.(ref)} style={styles.row}>
                    <T mono size={9} w={700} color={g.patternOnly ? theme.mute : accent.primary} style={styles.ref}>{ref}</T>
                    <View style={styles.grow}>
                      <T size={9}>{v.label}</T>
                      {!!v.example && <T mono size={8} dim>{tx('patterns.pathVarsHelp.eG', { v0: v.example })}</T>}
                    </View>
                  </Pressable>
                );
              })}
              {g.title.startsWith('解析した値') && extra.map((f) => (
                <Pressable key={f} disabled={!onInsert} onPress={() => onInsert?.(`{$${f}}`)} style={styles.row}>
                  <T mono size={9} w={700} color={accent.primary} style={styles.ref}>{`{$${f}}`}</T>
                  <T size={9} dim style={styles.grow}>{tx('patterns.pathVarsHelp.outputsAddedAddOns')}</T>
                </Pressable>
              ))}
            </View>
          ))}
          <T size={10} w={800}>{tx('patterns.pathVarsHelp.syntax')}</T>
          {PATH_TEMPLATE_RULES.map((r) => <T key={r} size={9} dim style={styles.rule}>{tx('patterns.pathVarsHelp.bullet', { v0: r })}</T>)}
          {!!onInsert && <T size={9} dim style={styles.rule}>{tx('patterns.pathVarsHelp.tapVariableAppend')}</T>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 4 },
  toggle: { paddingVertical: 4 },
  body: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  group: { marginBottom: 8 },
  note: { marginBottom: 4, lineHeight: 13 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  ref: { minWidth: 130 },
  grow: { flex: 1, minWidth: 0 },
  rule: { lineHeight: 14 },
});
