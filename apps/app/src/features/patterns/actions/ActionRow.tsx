import { ACTION_SCHEMA, type Action, type ActionDef, type FetchTextCtx } from '@tstag/core';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ActionParamInput } from './ActionParamInput';
import { ActionTypePicker } from './ActionTypePicker';
import { actionStyles as st } from './actionUi';
import { AddActionButton } from './AddActionButton';
import { SourceMapInput } from './SourceMapInput';
import { FetchTextPreview } from './FetchTextPreview';
import { useActionSchema } from './useActionSchema';
import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const SCHEMA_MAP = Object.fromEntries(ACTION_SCHEMA.map((s) => [s.key, s]));

/**
 * ANALYZE アクション1件の入力（元の encode.jsx の ActionRow）。上に種類と削除、下に引数（定義から組む）、
 * 種類によって入れ子のアクション（pattern・文字を取ってくる型）と予行検索（文字を取ってくる型。アドオンが名乗る）
 */
export function ActionRow({ action, onChange, onRemove, activeTextSource, patternsBySource, fetchCtx }: {
  action: Action; onChange: (a: Action) => void; onRemove: () => void;
  activeTextSource: string; patternsBySource: Record<string, string>; fetchCtx: FetchTextCtx;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { picker, fields } = useActionSchema();
  const isPC = useWindowDimensions().width >= 900;
  const pickerMap = Object.fromEntries(picker.map((s) => [s.key, s]));
  const t = action.type || 'setStr';
  // 入力の描き分けは元の定義（field_ref 等の型が細かい）を優先し、無ければサーバーの定義
  const schema: ActionDef = SCHEMA_MAP[t] ?? pickerMap[t] ?? picker[0]!;

  // 文字を取ってくる型の副題パターンは手で書かせず、予行検索で選んだ副題から作る
  const simple = schema.params.filter((p) => p.type !== 'source_to_dest_map' && p.type !== 'array<analyze>' && !(schema.fetch_text && p.key === 'pattern'));
  const mapParams = schema.params.filter((p) => p.type === 'source_to_dest_map');
  const twoCols = isPC && simple.length >= 2;
  const nested = (action.analyze as Action[] | undefined) ?? [];
  const setNested = (fn: (l: Action[]) => Action[]) => onChange({ ...action, analyze: fn(nested) });
  const nestedRows = (
    <>
      {nested.map((a, i) => (
        <ActionRow key={i} action={a} onChange={(v) => setNested((l) => l.map((x, k) => (k === i ? v : x)))} onRemove={() => setNested((l) => l.filter((_, k) => k !== i))}
          activeTextSource={activeTextSource} patternsBySource={patternsBySource} fetchCtx={fetchCtx} />
      ))}
      <AddActionButton nested onPress={() => setNested((l) => [...l, { type: 'setStr', field: '', str: '' }])}>{tx('patterns.actionRow.addNestedAction')}</AddActionButton>
    </>
  );
  const nestedPattern = patternsBySource[String(action.text || activeTextSource)];

  return (
    <View style={[styles.card, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      <View style={[st.row, styles.head, simple.length || mapParams.length ? styles.mb8 : null]}>
        <ActionTypePicker type={t} schema={schema} picker={picker} defOf={(k) => pickerMap[k] ?? SCHEMA_MAP[k]} onChange={onChange} />
        <Pressable onPress={onRemove} style={[styles.remove, { backgroundColor: errorBox.bg }]}><T size={11} w={800} color="#B00000">×</T></Pressable>
      </View>

      {simple.length > 0 && (
        <View style={[styles.grid, twoCols && styles.grid2]}>
          {simple.map((p) => (
            <View key={p.key} style={twoCols ? styles.half : null}>
              <ActionParamInput p={p} action={action} onChange={onChange} fields={fields} patternsBySource={patternsBySource} />
            </View>
          ))}
        </View>
      )}
      {mapParams.map((p) => <SourceMapInput key={p.key} p={p} action={action} onChange={onChange} />)}

      {t === 'switch' && (
        <T mono size={9} dim style={[styles.note, { backgroundColor: theme.surface, borderColor: theme.line }]}>{tx('patterns.actionRow.editSwitchListElse')}</T>
      )}
      {t === 'pattern' && (
        <View style={st.mt6}>
          {!!nestedPattern && (
            <T mono size={10} color={accent.primary} style={[st.autoPat, st.mb6, { backgroundColor: theme.surface, borderColor: accent.primary }]}>
              <T mono size={8} dim>pattern: </T>{nestedPattern}
            </T>
          )}
          <T mono size={9} dim style={st.mb4}>{tx('patterns.actionRow.nested')}</T>
          {nestedRows}
        </View>
      )}
      {schema.fetch_text && (
        <View style={st.mt6}>
          {schema.searchable && schema.addon && (
            <FetchTextPreview addon={schema.addon} action={action} nested={nested} onChange={onChange} fetchCtx={fetchCtx} />
          )}
          <T mono size={9} dim style={st.mb4}>{tx('patterns.actionRow.nestedSubtitle')}</T>
          {nestedRows}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, marginBottom: 5 },
  head: { gap: 6, alignItems: 'flex-start' },
  remove: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  grid: { gap: 5 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { width: '49%' },
  note: { marginTop: 6, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
  mb8: { marginBottom: 8 },
});
