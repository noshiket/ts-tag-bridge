import { StyleSheet, TextInput, View } from 'react-native';

import { FormRow, manualStyles as ms } from './manualParts';
import type { ManualReserve } from './useManualReserve';
import { DateInput } from '../../../ui/inputs/DateInput';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 呼ぶ API の見本と、番組情報（題名・局・日付・開始/終了。日付・時刻は打って入れる） */
export function ManualProgramInfo({ m }: { m: ManualReserve }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { form, set } = m;
  const mono = { borderColor: theme.frame, backgroundColor: theme.surface2, color: theme.ink };
  return (
    <>
      <View style={[styles.preview, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.06)' }]}>
        <T mono size={8} dim style={styles.upper}>ADD_RESERVE_MANUAL</T>
        <T mono size={10} color={accent.primary} style={styles.lh}>
          {`client.add_reserve_manual(\n  "${form.startdate}", "${form.starttime}", "${form.endtime}",\n  service="${form.service}",\n  title="${form.title || '(タイトル未入力)'}"\n)`}
        </T>
      </View>

      <SectionTitle>{tx('common.program')}</SectionTitle>
      <View style={styles.info}>
        <FormRow label={tx('library.musicSort.title')} en="title">
          <TextInput value={form.title} onChangeText={(v) => set('title', v)} placeholder={tx('reservations.manualProgramInfo.programNameOptional')} placeholderTextColor={theme.mute}
            style={[ms.big, mono, styles.sans]} />
        </FormRow>
        <FormRow label={tx('reservations.manualProgramInfo.service')} en="service (ONID-TSID-SID)">
          {m.services?.length ? (
            <Select label={tx('reservations.manualProgramInfo.service')} value={form.service} onChange={(v) => set('service', v)}
              options={m.services.map((s) => { const v = `${s.onid}-${s.tsid}-${s.sid}`; return { value: v, label: `${s.service_name || v} — ${v}` }; })} />
          ) : <T mono size={12} dim>{tx('common.loading')}</T>}
        </FormRow>
        <FormRow label={tx('epg.date')} en="startdate">
          <DateInput value={form.startdate} onChangeText={(v) => set('startdate', v)} style={[ms.big, mono]} />
        </FormRow>
        <View style={styles.times}>
          {([['starttime', tx('common.start2')], ['endtime', tx('common.end')]] as const).map(([k, l]) => (
            <View key={k} style={ms.grow}>
              <FormRow label={l} en={k}>
                <TextInput value={form[k].slice(0, 5)} onChangeText={(v) => set(k, `${v}:00`)} placeholder="HH:MM" placeholderTextColor={theme.mute}
                  keyboardType="numbers-and-punctuation" style={[ms.big, mono]} />
              </FormRow>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 16 },
  upper: { letterSpacing: 0.5, marginBottom: 3 },
  lh: { lineHeight: 15 },
  info: { gap: 10, marginBottom: 16 },
  sans: { fontFamily: undefined },
  times: { flexDirection: 'row', gap: 8 },
});
