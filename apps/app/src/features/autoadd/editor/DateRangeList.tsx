import { DOW_LABELS, NEW_DATE_RANGE, type DateRange } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Field, ToggleChip, formStyles } from '../../search/formParts';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const DAYS = DOW_LABELS.map((label, value) => ({ value, label }));

/** 時間帯の絞り込み（date_list）: 曜日と時刻の範囲を足す・消す、反転 */
export function DateRangeList({ list, onChange, not, onNot }: { list: DateRange[]; onChange: (l: DateRange[]) => void; not: boolean; onNot: (v: boolean) => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const upd = (i: number, k: keyof DateRange, v: number) => onChange(list.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return (
    <View>
      <View style={[formStyles.row, styles.mb6]}>
        <Field k="date_list" l="— 時間帯絞り込み" subOpacity={0.5} />
        <ToggleChip on={not} color={accent.tertiary} onPress={() => onNot(!not)}>{tx('autoReserve.dateRangeList.invert')}</ToggleChip>
      </View>
      <View style={styles.dates}>
        {list.map((e, i) => (
          <View key={i} style={[styles.date, { backgroundColor: theme.surface2 }]}>
            <View style={styles.dow}><Select label={tx('autoReserve.dateRangeList.startDay')} value={e.startDayOfWeek} options={DAYS} onChange={(v) => upd(i, 'startDayOfWeek', v)} /></View>
            <Num v={e.startHour} max={23} onChange={(v) => upd(i, 'startHour', v)} />
            <T size={10} dim>:</T>
            <Num v={e.startMin} max={59} onChange={(v) => upd(i, 'startMin', v)} />
            <T size={10} dim>〜</T>
            <View style={styles.dow}><Select label={tx('autoReserve.dateRangeList.endDay')} value={e.endDayOfWeek} options={DAYS} onChange={(v) => upd(i, 'endDayOfWeek', v)} /></View>
            <Num v={e.endHour} max={23} onChange={(v) => upd(i, 'endHour', v)} />
            <T size={10} dim>:</T>
            <Num v={e.endMin} max={59} onChange={(v) => upd(i, 'endMin', v)} />
            <Pressable onPress={() => onChange(list.filter((_, j) => j !== i))} style={[styles.rm, { borderColor: theme.line }]}>
              <T size={10} dim>✕</T>
            </Pressable>
          </View>
        ))}
      </View>
      <Pressable onPress={() => onChange([...list, { ...NEW_DATE_RANGE }])} style={[styles.add, { borderColor: theme.line }]}>
        <T mono size={11} dim>{tx('common.add')}</T>
      </Pressable>
    </View>
  );
}

function Num({ v, max, onChange }: { v: number; max: number; onChange: (v: number) => void }) {
  const { theme } = useTheme();
  return (
    <TextInput value={String(v)} keyboardType="number-pad" onChangeText={(x) => onChange(Math.min(max, Math.max(0, parseInt(x, 10) || 0)))}
      style={[styles.num, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
  );
}

const styles = StyleSheet.create({
  mb6: { marginBottom: 6 },
  dates: { gap: 5 },
  date: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', borderRadius: 9, paddingVertical: 6, paddingHorizontal: 8 },
  dow: { width: 56 },
  num: { width: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 7, borderWidth: 1.5, fontSize: 11, textAlign: 'center' },
  rm: { marginLeft: 'auto', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
  add: { marginTop: 6, padding: 7, borderRadius: 9, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center' },
});
