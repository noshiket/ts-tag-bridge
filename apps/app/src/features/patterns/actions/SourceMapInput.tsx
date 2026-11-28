import type { Action, ActionParam } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { ParamChip, ParamLabel, actionStyles as st, useInputStyle } from './actionUi';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 「取得ソース → 出力フィールド名」の対応（action.set）。ソースをチップで選び、出力の名前を書く */
export function SourceMapInput({ p, action, onChange }: { p: ActionParam; action: Action; onChange: (a: Action) => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const input = useInputStyle();
  const m = (action.set as Record<string, string> | undefined) ?? {};
  const setMap = (n: Record<string, string>) => onChange({ ...action, set: n });
  return (
    <View style={st.mt4}>
      <ParamLabel text={p.label} desc={tx('patterns.sourceMapInput.sourceOutputFieldName')} />
      <View style={[st.wrap, Object.keys(m).length ? st.mb4 : null]}>
        {(p.available_sources ?? []).map((s) => {
          const on = m[s.key] !== undefined;
          return <ParamChip key={s.key} label={s.key} on={on} color={accent.primary}
            onPress={() => { const n = { ...m }; if (on) delete n[s.key]; else n[s.key] = s.key; setMap(n); }} />;
        })}
      </View>
      {Object.entries(m).map(([k, v]) => (
        <View key={k} style={[st.row, st.center, st.mb3]}>
          <T mono size={8} color={accent.primary} style={styles.mapKey}>{`${k} →`}</T>
          <TextInput value={v} onChangeText={(nv) => setMap({ ...m, [k]: nv })} placeholder={tx('patterns.sourceMapInput.outputFieldName')} placeholderTextColor={theme.mute} style={[...input, st.grow]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mapKey: { minWidth: 110 },
});
