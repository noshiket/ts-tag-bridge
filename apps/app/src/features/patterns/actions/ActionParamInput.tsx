import { CONTEXT_REFS, PATH_CONTEXT_VARS, TEMPLATE_PLACEHOLDERS, type Action, type ActionParam } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ParamChip, ParamLabel, actionStyles as st, useInputStyle } from './actionUi';
import { FieldRefInput } from './FieldRefInput';
import { PathVarsHelp } from '../common/PathVarsHelp';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

const TEXT_SOURCES = ['$title', '$description', '$extended_info'];

/**
 * アクションの引数1つの入力。引数の型で描き分ける: 出力フィールド（field_ref）、文脈の参照（context_ref）、
 * 照合する文（text_source）、出力先（path_template）、差し込み文字（template_string / placeholder_ref）、それ以外は文字
 */
export function ActionParamInput({ p, action, onChange, fields, patternsBySource }: {
  p: ActionParam; action: Action; onChange: (a: Action) => void; fields: string[]; patternsBySource: Record<string, string>;
}) {
  const { theme, accent } = useTheme();
  const input = useInputStyle();
  const t = action.type || 'setStr';
  const val = String(action[p.key] !== undefined ? action[p.key] : (p.default ?? ''));
  const set = (v: unknown) => onChange({ ...action, [p.key]: v });
  const label = <ParamLabel text={p.label} desc={p.description} />;
  const text = (placeholder: string) => (
    <TextInput value={val} onChangeText={(v) => set(v)} placeholder={placeholder} placeholderTextColor={theme.mute} style={input} />
  );
  const chips = (list: string[], color: string, on: (x: string) => boolean, press: (x: string) => void, style: object | null = st.mb3) => (
    <View style={[st.wrap, style]}>{list.map((x) => <ParamChip key={x} label={x} on={on(x)} color={color} onPress={() => press(x)} />)}</View>
  );

  if (p.type === 'field_ref') return <FieldRefInput label={p.label} desc={p.description} value={val} fields={fields} onChange={set} />;
  if (p.type === 'context_ref') {
    return <View>{label}{chips(CONTEXT_REFS, accent.primary, (f) => val === f, (f) => set(val === f ? '' : f), null)}</View>;
  }
  if (p.type === 'text_source') {
    const cur = val || '$title';
    return (
      <View>
        {label}
        <View style={st.row}>
          {TEXT_SOURCES.map((s) => (
            <Pressable key={s} onPress={() => onChange({ ...action, [p.key]: s, pattern: patternsBySource[s] || action.pattern || '' })}
              style={[styles.src, { backgroundColor: cur === s ? accent.primary : theme.surface, borderColor: cur === s ? accent.primary : theme.line }]}>
              <T mono size={9} w={700} color={cur === s ? '#fff' : theme.mute}>{s.replace('$', '')}</T>
            </Pressable>
          ))}
        </View>
        {!!action.pattern && <T mono size={10} color={accent.primary} style={[st.autoPat, { backgroundColor: theme.surface, borderColor: theme.line }]}>{String(action.pattern)}</T>}
      </View>
    );
  }
  if (p.type === 'path_template') {
    const fieldRefs = fields.map((f) => `{$${f}}`);
    return (
      <View>
        {label}
        {chips(fieldRefs, accent.primary, (x) => val.includes(x), (x) => set(val + x))}
        {chips(PATH_CONTEXT_VARS, accent.secondary, (x) => val.includes(x), (x) => set(val + x), st.mb4)}
        {text(String(p.default || p.label))}
        <PathVarsHelp template={val} extraFields={fields} onInsert={(x) => set(val + x)} />
      </View>
    );
  }
  if (p.type === 'template_string') {
    // 照合タイトルは他のアクションが済んでから解決するので、setStr 等で入れた値（{$title} 等）も使える
    const refs = t === 'addList' ? fields.map((f) => `{$${f}}`)
      : p.refs_fields ? [...fields.map((f) => `{$${f}}`), ...CONTEXT_REFS] : CONTEXT_REFS;
    return (
      <View>
        {label}
        <View style={[st.wrap, st.mb3]}>
          {TEMPLATE_PLACEHOLDERS.map((x) => <ParamChip key={x} label={x} on={val.includes(x)} color={accent.primary} onPress={() => set(val + x)} />)}
          {refs.map((x) => <ParamChip key={`r${x}`} label={x} on={val.includes(x)} color={accent.secondary} onPress={() => set(val + x)} />)}
        </View>
        {text(String(p.default || p.label))}
      </View>
    );
  }
  if (p.type === 'placeholder_ref') {
    return <View>{label}{chips(TEMPLATE_PLACEHOLDERS, accent.primary, (x) => val === x, (x) => set(x))}{text(String(p.default || '{$1}'))}</View>;
  }
  return <View>{label}{text(String(p.default || p.label))}</View>;
}

const styles = StyleSheet.create({
  src: { flex: 1, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 6, borderWidth: 1.5, alignItems: 'center' },
});
