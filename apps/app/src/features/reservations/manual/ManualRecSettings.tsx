import type { MsgKey } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { Box, Cell, Hint, Row, manualStyles as ms, useSmallInput } from './manualParts';
import type { ManualReserve } from './useManualReserve';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { Select, type SelectOption } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

type NumKey = 'recMode' | 'priority' | 'tuijyuuFlag' | 'pittariFlag' | 'serviceMode' | 'tunerID' | 'suspendMode'
  | 'partialRecFlag' | 'continueRecFlag' | 'rebootFlag' | 'useDefMargin';
const YN: [number, MsgKey][] = [[0, 'recresult.qc.none'], [1, 'common.yes']];
const opts = <V extends string | number>(pairs: [V, string][]): SelectOption<V>[] => pairs.map(([value, label]) => ({ value, label }));

/** 録画設定（EDCB の名前と既定値つき）・マージンを指定する時の前後の秒・録画フォルダ */
export function ManualRecSettings({ m }: { m: ManualReserve }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const small = useSmallInput();
  const { form, set, o } = m;
  const yn = YN.map(([v, l]) => [v, tx(l)] as [number, string]);
  const rows: { k: NumKey; label: string; def: string; opts: [number, string][] }[] = [
    { k: 'recMode', label: tx('common.recordingMode'), def: tx('reservations.manualRecSettings.specified'), opts: [[1, tx('reservations.manualRecSettings.specified')], [2, tx('reservations.manualRecSettings.all')]] },
    { k: 'priority', label: tx('common.priority'), def: tx('reservations.manualRecSettings.normal'), opts: [[1, tx('reservations.manualRecSettings.low')], [2, tx('reservations.manualRecSettings.normal')], [3, tx('reservations.manualRecSettings.high')], [4, tx('reservations.manualRecSettings.highest')]] },
    { k: 'tuijyuuFlag', label: tx('reservations.manualRecSettings.follow'), def: tx('common.yes'), opts: [[1, tx('common.yes')], [0, tx('recresult.qc.none')]] },
    { k: 'pittariFlag', label: tx('reservations.manualRecSettings.exact'), def: tx('recresult.qc.none'), opts: yn },
    { k: 'serviceMode', label: tx('reservations.manualRecSettings.conversion'), def: tx('common.yes'), opts: [[1, tx('common.yes')], [0, tx('recresult.qc.none')]] },
    { k: 'tunerID', label: tx('common.tuner'), def: tx('common.auto'), opts: [[0, tx('common.auto')], ...(m.tuners ?? []).filter((t) => t.tuner_id > 0).map((t): [number, string] => [t.tuner_id, t.tuner_name || `Tuner ${t.tuner_id}`])] },
    { k: 'suspendMode', label: tx('common.afterRecording'), def: tx('common.doNothing'), opts: [[0, tx('common.doNothing')], [1, tx('common.standby')], [2, tx('common.hibernate')], [3, tx('common.shutDown')]] },
    { k: 'partialRecFlag', label: tx('reservations.manualRecSettings.partialRecording'), def: tx('recresult.qc.none'), opts: yn },
    { k: 'continueRecFlag', label: tx('common.continuousRecording'), def: tx('recresult.qc.none'), opts: yn },
    { k: 'rebootFlag', label: tx('reservations.manualRecSettings.rebootAfterRecording'), def: tx('recresult.qc.none'), opts: yn },
    { k: 'useDefMargin', label: tx('reservations.manualRecSettings.margin'), def: o?.defaultStartMargin != null ? `前${o.defaultStartMargin}秒・後${o.defaultEndMargin}秒` : tx('reservations.manualRecSettings.setting'), opts: [[1, tx('common.default2')], [0, tx('reservations.manualRecSettings.custom')]] },
  ];
  return (
    <>
      <SectionTitle>{tx('reservations.manualRecSettings.recordingSettingsRecSettings')}</SectionTitle>
      <Box>
        {rows.map((f, i) => (
          <Row key={f.k} en={f.k} ja={f.label} def={f.def} last={i === rows.length - 1}>
            <Select label={f.label} value={form[f.k]} options={opts(f.opts)} onChange={(v) => set(f.k, v)} />
          </Row>
        ))}
        {form.useDefMargin === 0 && (
          <View style={[styles.margins, { borderTopColor: theme.line }]}>
            {([['startMargin', tx('reservations.manualRecSettings.startMarginS')], ['endMargin', tx('reservations.manualRecSettings.endMarginS')]] as const).map(([k, l], i) => (
              <View key={k} style={[styles.margin, i === 0 && { borderRightWidth: 1, borderRightColor: theme.line }]}>
                <T mono size={9} dim style={ms.mb4}>{l}</T>
                <TextInput value={String(form[k])} keyboardType="number-pad" onChangeText={(v) => set(k, parseInt(v, 10) || 0)} style={small} />
              </View>
            ))}
          </View>
        )}
        <Cell top>
          <Hint en="recFolder" rest={tx('reservations.manualRecSettings.blank', { v0: o?.defaultRecFolder || tx('common.setting') })} />
          <TextInput value={form.recFolder} onChangeText={(v) => set('recFolder', v)} placeholder="!Default" placeholderTextColor={theme.mute} style={small} />
        </Cell>
      </Box>
    </>
  );
}

const styles = StyleSheet.create({
  margins: { flexDirection: 'row', borderTopWidth: 1 },
  margin: { flex: 1, paddingVertical: 9, paddingHorizontal: 12 },
});
