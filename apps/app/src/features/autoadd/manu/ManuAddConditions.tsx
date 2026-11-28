import { DOW_LABELS, DOW_PRESETS, hasDow, type ManuAddForm, type Service } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { ServicePicker } from '../../../ui/inputs/ServicePicker';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Field } from '../../search/formParts';
import { useT } from '../../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);

/** プログラム予約の「予約条件」: 番組名・局（1局だけ）・開始と終了（HH:MM で打つ）・曜日（よく使う組み合わせも） */
export function ManuAddConditions({ form, set, services }: {
  form: ManuAddForm; set: <K extends keyof ManuAddForm>(k: K, v: ManuAddForm[K]) => void; services: Service[] | undefined;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const input = [styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }];
  return (
    <>
      <View>
        <Field k="title" l="— 番組名（省略可）" subOpacity={0.5} />
        <TextInput value={form.title} onChangeText={(v) => set('title', v)} placeholder={tx('autoReserve.manuAddConditions.eGNews')} placeholderTextColor={theme.mute}
          style={[input, styles.title]} />
      </View>
      <View>
        <Field k="service_id" l="— 放送局（1局のみ）" subOpacity={0.5}>
          <T mono size={9} w={700} color={RED}>{tx('autoReserve.manuAddConditions.required')}</T>
        </Field>
        <ServicePicker services={services} selected={form.service_id ? [form.service_id] : []}
          onToggle={(k) => set('service_id', form.service_id === k ? '' : k)} />
      </View>
      {/* 時刻は HH:MM で打つ（Web の時刻の入力欄の代わり） */}
      <View style={styles.times}>
        {([['start_time', tx('autoReserve.manuAddConditions.start')], ['end_time', tx('autoReserve.manuAddConditions.end')]] as const).map(([k, l]) => (
          <View key={k} style={styles.grow}>
            <Field k={k} l={l} subOpacity={0.5}><T mono size={9} w={700} color={RED}>{' *'}</T></Field>
            <TextInput value={form[k]} onChangeText={(v) => set(k, v)} placeholder="HH:MM" placeholderTextColor={theme.mute}
              keyboardType="numbers-and-punctuation" style={input} />
          </View>
        ))}
      </View>
      <View>
        <View style={styles.dowHead}>
          <Field k="day_of_week_flag" l="— 曜日（bit0=日〜bit6=土）" subOpacity={0.5} />
          {DOW_PRESETS.map(([l, v]) => (
            <Pressable key={l} onPress={() => set('day_of_week_flag', v)} style={[styles.preset, { borderColor: theme.line }]}>
              <T mono size={9} dim>{l}</T>
            </Pressable>
          ))}
        </View>
        <View style={styles.dows}>
          {DOW_LABELS.map((d, bit) => {
            const on = hasDow(form.day_of_week_flag, bit);
            return (
              <Pressable key={d} onPress={() => set('day_of_week_flag', form.day_of_week_flag ^ (1 << bit))}
                style={[styles.dow, { backgroundColor: on ? accent.primary : 'transparent', borderColor: on ? accent.primary : theme.line }]}>
                <T size={12} w={800} color={on ? '#fff' : theme.ink}>{d}</T>
              </Pressable>
            );
          })}
          <T mono size={9} dim style={styles.flag}>{`(${form.day_of_week_flag})`}</T>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 12, fontFamily: monoFamily[400] },
  title: { fontSize: 14, fontFamily: monoFamily[700] },
  times: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  dowHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  preset: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999, borderWidth: 1, marginBottom: 4 },
  dows: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dow: { width: 32, height: 32, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  flag: { marginLeft: 4 },
});
