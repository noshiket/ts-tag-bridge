import { applyRecPreset, type RecSettingForm as Form, type RecSettingOptions } from '@tstag/core';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Select, type SelectOption } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

type Tuner = { tuner_id: number; tuner_name: string };
const opts = (pairs: [number, string][]): SelectOption<number>[] => pairs.map(([value, label]) => ({ value, label }));

/**
 * 録画設定の入力（EDCB の録画設定ダイアログに沿った並び。元の RecSettingForm）。
 * プリセットを選ぶと全項目に値を広げる。original があれば「現在の設定値」に戻せる
 */
export function RecSettingFormView<T extends Form>({ value: v, onChange, recOpts, tuners, original }: {
  value: T;
  onChange: (v: T) => void;
  recOpts: RecSettingOptions | undefined;
  tuners: Tuner[] | undefined;
  original?: Form;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const set = (patch: Partial<Form>) => onChange({ ...v, ...patch });
  const sel = (k: keyof Form, label: string, pairs: [number, string][]) => (
    <Field label={label}><Select label={label} value={v[k] as number} options={opts(pairs)} onChange={(x) => set({ [k]: x } as Partial<Form>)} /></Field>
  );
  const text = (k: keyof Form, ph: string) => (
    <TextInput value={String(v[k] ?? '')} onChangeText={(x) => set({ [k]: x } as Partial<Form>)} placeholder={ph} placeholderTextColor={theme.mute}
      autoCapitalize="none" autoCorrect={false} style={[styles.input, { backgroundColor: theme.surface2, borderColor: theme.line, color: theme.ink }]} />
  );
  const num = (k: 'startMargin' | 'endMargin') => (
    <TextInput value={String(v[k])} onChangeText={(x) => set({ [k]: Number(x) || 0 })} keyboardType="number-pad"
      style={[styles.input, { backgroundColor: theme.surface2, borderColor: theme.line, color: theme.ink }]} />
  );
  // 選択肢があれば選ぶ、無ければ書く（EDCB から取れなかった時）
  const plug = (k: 'writePlugIn' | 'recNamePlugIn' | 'batFilePath', label: string) => {
    const list = recOpts?.[k] ?? [];
    return (
      <Field label={label}>
        {list.length > 0
          ? <Select label={label} value={v[k]} onChange={(x) => set({ [k]: x })} options={[{ value: '', label: tx('common.none') }, ...list]} />
          : text(k, tx('common.none'))}
      </Field>
    );
  };
  const presets = recOpts?.presets ?? [];
  return (
    <View>
      {presets.length > 0 && (
        <View style={styles.mb10}>
          <Field label={tx('recSetting.recSettingForm.presetChoosingOneFills')}>
            <Select label={tx('common.preset')} value={v.presetID}
              options={[{ value: '', label: original ? tx('recSetting.form.current') : tx('recSetting.recSettingForm.manual') }, ...presets.map((p) => ({ value: String(p.value), label: p.label }))]}
              onChange={(pid) => onChange(applyRecPreset(v, pid, recOpts, original))} />
          </Field>
        </View>
      )}
      <Row>
        {sel('recMode', tx('common.recordingMode'), [[1, tx('recSetting.recSettingForm.specifiedService')], [2, tx('recSetting.recSettingForm.allServices')]])}
        {sel('priority', tx('common.priority'), [[1, tx('recSetting.recSettingForm.1Low')], [2, '2'], [3, '3'], [4, tx('recSetting.recSettingForm.4High')]])}
      </Row>
      <Row>
        {sel('tuijyuuFlag', tx('recSetting.recSettingForm.followEventRelay'), [[1, tx('recSetting.recSettingForm.yes')], [0, tx('recSetting.recSettingForm.no')]])}
        {sel('pittariFlag', tx('recSetting.recSettingForm.exact'), [[0, tx('recSetting.recSettingForm.no')], [1, tx('recSetting.recSettingForm.yes')]])}
      </Row>
      <Row>
        {sel('useDefMargin', tx('recSetting.recSettingForm.recordingMargin'), [[1, tx('common.default2')], [0, tx('recSetting.recSettingForm.custom')]])}
        {v.useDefMargin === 0 && <Field label={tx('recSetting.recSettingForm.startS')}>{num('startMargin')}</Field>}
        {v.useDefMargin === 0 && <Field label={tx('recSetting.recSettingForm.endS')}>{num('endMargin')}</Field>}
      </Row>
      <Row>
        {sel('serviceMode', tx('recSetting.recSettingForm.captionEtcServiceConversion'), [[1, tx('recSetting.recSettingForm.yes')], [0, tx('recSetting.recSettingForm.no')]])}
        {sel('partialRecFlag', tx('recSetting.recSettingForm.partialReception'), [[0, tx('recSetting.recSettingForm.no')], [1, tx('recSetting.recSettingForm.yes')]])}
        {sel('continueRecFlag', tx('common.continuousRecording'), [[0, tx('recSetting.recSettingForm.no')], [1, tx('recSetting.recSettingForm.yes')]])}
      </Row>
      <Row>
        {sel('tunerID', tx('common.tuner'), [[0, tx('common.auto')], ...(tuners ?? []).filter((t) => t.tuner_id > 0).map((t): [number, string] => [t.tuner_id, t.tuner_name || `Tuner ${t.tuner_id}`])])}
        {sel('suspendMode', tx('common.afterRecording'), [[0, tx('common.doNothing')], [1, tx('common.standby')], [2, tx('common.hibernate')], [3, tx('common.shutDown')]])}
        {sel('rebootFlag', tx('recSetting.recSettingForm.rebootAfterResume'), [[0, tx('recSetting.recSettingForm.no')], [1, tx('recSetting.recSettingForm.yes')]])}
      </Row>
      <View style={[styles.rule, { borderTopColor: theme.line }]}>
        <View style={styles.mb8}><Field label={tx('recSetting.recSettingForm.recordingFolderBlankUses')}>{text('recFolder', '!Default')}</Field></View>
        <Row>
          {plug('writePlugIn', tx('recSetting.recSettingForm.outputWritePlug'))}
          {plug('recNamePlugIn', tx('recSetting.recSettingForm.fileNamePlug'))}
        </Row>
        <View style={styles.mb8}><Field label={tx('recSetting.recSettingForm.fileNameOptionRecname')}>{text('recName', tx('common.omitted'))}</Field></View>
        <Row>
          {plug('batFilePath', tx('recSetting.recSettingForm.postRecording'))}
          <Field label={tx('recSetting.recSettingForm.tag')}>{text('batFileTag', tx('common.omitted'))}</Field>
        </Row>
      </View>
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><T mono size={9} dim style={styles.label}>{label}</T>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  field: { flex: 1, minWidth: 0 },
  label: { marginBottom: 3 },
  input: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  rule: { borderTopWidth: 1, paddingTop: 8 },
  mb8: { marginBottom: 8 },
  mb10: { marginBottom: 10 },
});
