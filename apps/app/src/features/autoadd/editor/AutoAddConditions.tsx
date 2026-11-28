import type { MsgKey } from '@tstag/core';
import type { AutoAddForm, Service } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { DateRangeList } from './DateRangeList';
import { GuideChannelPicker, type GuideChannel } from './GuideChannelPicker';
import { HistoryInput } from '../../../ui/inputs/HistoryInput';
import { ServicePicker } from '../../../ui/inputs/ServicePicker';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { ClearLink, Field, GenrePicker, ToggleChip, formStyles } from '../../search/formParts';
import { useT } from '../../../ui/i18n/I18n';

const FLAGS: [keyof AutoAddForm, MsgKey][] = [['titleOnlyFlag', 'common.titleOnly'], ['aimaiFlag', 'common.fuzzy'], ['regExpFlag', 'common.regex'], ['caseFlag', 'autoReserve.autoAddConditions.caseSensitive']];
const CA: [number, MsgKey][] = [[0, 'filter.all'], [1, 'common.freeOnly'], [2, 'common.paidOnly']];
const OPTIONS: [keyof AutoAddForm, MsgKey][] = [['chkRecEnd', 'autoReserve.autoAddConditions.checkSameTitleRecordings'], ['chkRecNoService', 'autoReserve.autoAddConditions.disableAllServices']];

/**
 * EPG キーワード自動予約の「検索条件」（元の AutoAddDetailScreen の検索条件タブ）。
 * 1つのルールは EDCB の局か配信の局のどちらか一方（片方を選んでいる間はもう片方を選べない）
 */
export function AutoAddConditions({ form, set, services, guideChans, recorderLabel, addonChs, setAddonChs }: {
  form: AutoAddForm;
  set: <K extends keyof AutoAddForm>(k: K, v: AutoAddForm[K]) => void;
  services: Service[] | undefined;
  /** 配信の局（録画アドオンがある時だけ） */
  guideChans: GuideChannel[];
  recorderLabel: string | null;
  addonChs: string[];
  setAddonChs: (f: (p: string[]) => string[]) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const addonMode = addonChs.length > 0;
  const edcbMode = form.serviceList.length > 0;
  const input = [styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }];
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);
  const toggleSvc = (k: string) => set('serviceList', form.serviceList.includes(k) ? form.serviceList.filter((x) => x !== k) : [...form.serviceList, k]);

  return (
    <>
      <View style={styles.top3}>
        <Field k="and_key" />
        <HistoryInput histKey="epg_and_key" value={form.andKey} onChangeText={(v) => set('andKey', v)}
          style={[input, styles.andKey, { borderColor: theme.frame }]} />
      </View>
      <View style={styles.top2}>
        <Field k="not_key" l="— NOTキーワード" subOpacity={0.5} />
        <HistoryInput histKey="epg_not_key" value={form.notKey} onChangeText={(v) => set('notKey', v)} placeholder={tx('common.eGRerun')} style={input} />
      </View>
      <View>
        <Field k="note" l="— メモ" subOpacity={0.5} />
        <TextInput value={form.note} onChangeText={(v) => set('note', v)} placeholder={tx('autoReserve.autoAddConditions.note')} placeholderTextColor={theme.mute} style={input} />
      </View>

      <View>
        <Field k="フラグ" />
        <View style={formStyles.wrap5}>
          {FLAGS.map(([k, l]) => <ToggleChip key={k} on={!!form[k]} color={accent.tertiary} onPress={() => set(k, !form[k] as never)}>{tx(l)}</ToggleChip>)}
        </View>
      </View>

      <View>
        <Field k="free_ca_flag" l="— スクランブル" subOpacity={0.5} />
        <View style={styles.row5}>
          {CA.map(([v, l]) => <ToggleChip key={v} on={form.freeCAFlag === v} color={accent.primary} onPress={() => set('freeCAFlag', v)}>{tx(l)}</ToggleChip>)}
        </View>
      </View>

      <GenrePicker label={<Field k="content_list" l="— ジャンル" subOpacity={0.5} />} list={form.contentList} onChange={(v) => set('contentList', v)}
        not={form.notContetFlag} onNot={(v) => set('notContetFlag', v)} />

      <View>
        <View style={formStyles.row}>
          <Field k="service_list" l="— 空=全チャンネル" subOpacity={0.5} />
          {form.serviceList.length > 0 && <ClearLink onPress={() => set('serviceList', [])} />}
        </View>
        {addonMode && <T size={10} dim style={styles.mb4}>{tx('autoReserve.autoAddConditions.notAvailableWhileStreaming')}</T>}
        <View style={addonMode ? styles.off : undefined} pointerEvents={addonMode ? 'none' : 'auto'}>
          <ServicePicker services={services} selected={form.serviceList} onToggle={toggleSvc}
            onSetGroup={(keys, on) => set('serviceList', on
              ? [...form.serviceList, ...keys.filter((k) => !form.serviceList.includes(k))]
              : form.serviceList.filter((k) => !keys.includes(k)))} />
        </View>
      </View>

      {/* 番組表アドオンの局（配信など）。選んだ局の番組表にもこのルールを当てて、配信の予約録画アドオンが予約する */}
      {recorderLabel && guideChans.length > 0 && (
        <GuideChannelPicker guideChans={guideChans} recorderLabel={recorderLabel} addonChs={addonChs} setAddonChs={setAddonChs} edcbMode={edcbMode} />
      )}

      <View>
        <Field k="chk_duration" l="— 番組長（分、0=指定なし）" subOpacity={0.5} />
        <View style={styles.durRow}>
          <TextInput value={form.chkDurationMin ? String(form.chkDurationMin) : ''} onChangeText={(v) => set('chkDurationMin', num(v))} placeholder="0"
            keyboardType="number-pad" placeholderTextColor={theme.mute} style={[styles.dur, input]} />
          <T size={11} dim>{tx('common.minMore')}</T>
          <TextInput value={form.chkDurationMax ? String(form.chkDurationMax) : ''} onChangeText={(v) => set('chkDurationMax', num(v))} placeholder="∞"
            keyboardType="number-pad" placeholderTextColor={theme.mute} style={[styles.dur, input]} />
          <T size={11} dim>{tx('common.minLess')}</T>
        </View>
      </View>

      <View>
        <Field k="追加オプション" />
        <View style={[formStyles.wrap5, styles.mb8]}>
          {OPTIONS.map(([k, l]) => <ToggleChip key={k} on={!!form[k]} color={accent.secondary} onPress={() => set(k, !form[k] as never)}>{tx(l)}</ToggleChip>)}
        </View>
        <View style={styles.durRow}>
          <T mono size={9} dim>chk_rec_day</T>
          <TextInput value={form.chkRecDay ? String(form.chkRecDay) : ''} onChangeText={(v) => set('chkRecDay', num(v))} placeholder="0"
            keyboardType="number-pad" placeholderTextColor={theme.mute} style={[styles.dur, input]} />
          <T size={11} dim>{tx('autoReserve.autoAddConditions.days0All')}</T>
        </View>
      </View>

      <DateRangeList list={form.dateList} onChange={(v) => set('dateList', v)} not={form.notDateFlag} onNot={(v) => set('notDateFlag', v)} />
    </>
  );
}

const styles = StyleSheet.create({
  top3: { zIndex: 3 },
  top2: { zIndex: 2 },
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 12, fontFamily: monoFamily[400] },
  andKey: { fontSize: 15, fontFamily: monoFamily[700] },
  row5: { flexDirection: 'row', gap: 5 },
  mb4: { marginBottom: 4 },
  mb8: { marginBottom: 8 },
  off: { opacity: 0.35 },
  durRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dur: { width: 72, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8 },
});
