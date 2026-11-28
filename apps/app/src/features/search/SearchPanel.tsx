import type { MsgKey } from '@tstag/core';
import type { SearchQuery, Service } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { HistoryInput } from '../../ui/inputs/HistoryInput';
import { Spark } from '../../ui/parts/Icons';
import { ServicePicker } from '../../ui/inputs/ServicePicker';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { ClearLink, Field, GenrePicker, ToggleChip as Chip } from './formParts';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const FLAGS: [keyof SearchQuery, MsgKey][] = [['titleOnly', 'common.titleOnly'], ['aimai', 'common.fuzzy'], ['regExp', 'common.regex'], ['archive', 'search.searchPanel.archive']];
const CA: [0 | 1 | 2, MsgKey][] = [[0, 'filter.all'], [1, 'common.freeOnly'], [2, 'common.paidOnly']];

/**
 * 番組検索の条件（元の search.jsx の SearchPanel）: AND / NOT キーワード（履歴つき）、番組名のみ・あいまい・正規表現・アーカイブ、
 * スクランブル、ジャンル（大ジャンルを押すと中ジャンルを全部。どれか選ぶと中ジャンルを開く。NOT 扱い）、局、番組長、日数
 */
export function SearchPanel({ q, setQ, services, searching, onSearch, onClear, onConvertToAutoAdd }: {
  q: SearchQuery;
  setQ: (f: (p: SearchQuery) => SearchQuery) => void;
  services: Service[] | undefined;
  searching: boolean;
  onSearch: () => void;
  onClear: () => void;
  /** 自動予約のルールを作る（まだ作っていない画面なので、無い時は出さない） */
  onConvertToAutoAdd?: () => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const set = <K extends keyof SearchQuery>(k: K, v: SearchQuery[K]) => setQ((p) => ({ ...p, [k]: v }));
  const toggleSvc = (k: string) =>
    setQ((p) => ({ ...p, serviceList: p.serviceList.includes(k) ? p.serviceList.filter((x) => x !== k) : [...p.serviceList, k] }));
  const input = { borderColor: theme.line, backgroundColor: theme.surface2 };
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
      {/* 履歴の候補が下の欄に隠れないよう、キーワードの2つは上に重ねる */}
      <View style={styles.top2}>
        <Field k="and_key" l={tx('search.panel.and')} />
        <HistoryInput histKey="epg_and_key" value={q.andkey} onChangeText={(v) => set('andkey', v)} onSubmit={onSearch}
          placeholder={tx('search.searchPanel.eGSpecialFeature')} style={[input, { borderColor: theme.frame }]} />
      </View>
      <View style={styles.top1}>
        <Field k="not_key" l={tx('search.panel.not')} />
        <HistoryInput histKey="epg_not_key" value={q.notkey} onChangeText={(v) => set('notkey', v)} placeholder={tx('common.eGRerun')} style={input} />
      </View>

      <View style={styles.wrap}>
        {FLAGS.map(([k, l]) => <Chip key={k} on={!!q[k]} color={accent.tertiary} onPress={() => set(k, !q[k] as never)}>{tx(l)}</Chip>)}
      </View>

      <View>
        <Field k="free_ca_flag" l={tx('search.panel.scramble')} />
        <View style={styles.row5}>
          {CA.map(([v, l]) => <Chip key={v} on={q.freeCaFlag === v} color={accent.primary} onPress={() => set('freeCaFlag', v)}>{tx(l)}</Chip>)}
        </View>
      </View>

      <GenrePicker label={<Field k="content_list" l={tx('search.panel.genre')} />} list={q.contentList} onChange={(v) => set('contentList', v)}
        not={q.notContent} onNot={(v) => set('notContent', v)} />

      <View>
        <View style={styles.fieldRow}>
          <Field k="service_list" l={tx('search.panel.channel')} />
          {q.serviceList.length > 0 && <ClearLink onPress={() => set('serviceList', [])} />}
        </View>
        <ServicePicker services={services} selected={q.serviceList} onToggle={toggleSvc}
          onSetGroup={(keys, on) => setQ((p) => ({
            ...p, serviceList: on ? [...p.serviceList, ...keys.filter((k) => !p.serviceList.includes(k))] : p.serviceList.filter((k) => !keys.includes(k)),
          }))} />
      </View>

      <View>
        <Field k="chk_duration" l={tx('search.panel.length')} />
        <View style={styles.durRow}>
          <TextInput value={q.durationMin ? String(q.durationMin) : ''} onChangeText={(v) => set('durationMin', num(v))} placeholder="0"
            keyboardType="number-pad" placeholderTextColor={theme.mute} style={[styles.dur, input, { color: theme.ink }]} />
          <T size={11} dim>{tx('common.minMore')}</T>
          <TextInput value={q.durationMax ? String(q.durationMax) : ''} onChangeText={(v) => set('durationMax', num(v))} placeholder="∞"
            keyboardType="number-pad" placeholderTextColor={theme.mute} style={[styles.dur, input, { color: theme.ink }]} />
          <T size={11} dim>{tx('common.minLess')}</T>
        </View>
      </View>

      <View>
        <Field k="days" l={tx('search.panel.days')} />
        <TextInput value={String(q.days)} onChangeText={(v) => set('days', Math.min(30, num(v)))} keyboardType="number-pad"
          style={[styles.input, input, { color: theme.ink }]} />
      </View>

      <View style={styles.btns}>
        <Pressable onPress={onSearch} disabled={searching} style={[styles.go, {
          backgroundColor: searching ? theme.surface2 : accent.primary, borderColor: theme.frame, boxShadow: searching ? 'none' : shadow(theme, 2),
        }]}>
          <T mono size={12} w={800} color={searching ? theme.mute : '#fff'}>{searching ? tx('common.searching') : tx('search.searchPanel.search')}</T>
        </Pressable>
        <Pressable onPress={onClear} style={[styles.clear, { borderColor: theme.frame }]}>
          <T size={12} w={700}>{tx('search.searchPanel.clear')}</T>
        </Pressable>
      </View>
      {!!q.andkey && onConvertToAutoAdd && (
        <Pressable onPress={onConvertToAutoAdd} style={[styles.toAuto, { borderColor: accent.secondary }]}>
          <Spark s={12} c={accent.secondary} />
          <T mono size={11} w={800} color={accent.secondary}>{tx('search.searchPanel.createAutoReserveRule')}</T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 12 },
  top2: { zIndex: 2 },
  top1: { zIndex: 1 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row5: { flexDirection: 'row', gap: 5 },
  durRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dur: { width: 72, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1.5, fontSize: 12 },
  input: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 12 },
  btns: { flexDirection: 'row', gap: 6 },
  go: { flex: 2, padding: 11, borderRadius: 11, borderWidth: 1.5, alignItems: 'center' },
  clear: { flex: 1, padding: 11, borderRadius: 11, borderWidth: 1.5, alignItems: 'center' },
  toAuto: {
    padding: 10, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
});
