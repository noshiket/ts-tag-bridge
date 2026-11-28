import {
  activeReserveFilterCount, filterReserves, paginate, reserveFacets, reserveStatus, tunerMapOf,
  type Reserve, type ReserveFilters,
} from '@tstag/core';
import { useReserveActions, useReserves, useTunerReserves } from '@tstag/core/react';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReserveActionSheet } from '../../../features/reservations/ReserveActionSheet';
import { ReserveCard } from '../../../features/reservations/ReserveCard';
import { PosterReserveCard } from '../../../features/reservations/views/PosterReserveCard';
import { TableReserveList } from '../../../features/reservations/views/TableReserveList';
import { useReserveThumb } from '../../../features/reservations/useReserveThumb';
import { ReserveFilterPanel } from '../../../features/reservations/ReserveFilterPanel';
import { StatStrip } from '../../../features/reservations/StatStrip';
import { useReserveListState } from '../../../features/reservations/state';
import { useViewNode } from '../../../lib/state/viewNode';
import { FilterToggle } from '../../../ui/inputs/FilterToggle';
import { Plus, Refresh } from '../../../ui/parts/Icons';
import { PagerBar } from '../../../ui/parts/PagerBar';
import { pullToRefresh } from '../../../ui/gestures/PullToRefresh';
import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';
import { IconButton, TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';
import { useAppActive } from '../../../lib/lifecycle/appActive';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import { shadow } from '../../../ui/theme/edge';

const DUP = '#816BD8';

/** 予約一覧（元の reservations.jsx）。右上の「自動予約」「手動予約」からそれぞれの画面へ */
export default function ReservationsScreen() {
  useBgRenderCount('Reservations');
  const { theme, accent, pageSize, reserveView } = useTheme();
  const { t: tx } = useT();
  const { viewNode } = useViewNode();
  const reserves = useReserves(viewNode);
  const tuners = useTunerReserves(viewNode);
  const actions = useReserveActions(viewNode);
  const [s, set] = useReserveListState();
  const [menu, setMenu] = useState<Reserve | null>(null);
  const list = reserves.data ?? [];

  // 録画中のカードの進み具合を動かす時計（録画中がある間だけ 10 秒ごと）
  const [now, setNow] = useState(() => Date.now());
  const anyRecording = list.some((r) => reserveStatus(r, now) === 'recording');
  // 前にいる間だけ（背面で描き直さない）
  const appActive = useAppActive();
  useEffect(() => {
    if (!anyRecording || !appActive) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [anyRecording, appActive]);

  const thumbOf = useReserveThumb();

  // チューナーの割り当ては見ているサーバーのもの（他のサーバーは中継で取る。取れなければ出さない・絞らない）
  const tunerOf = useMemo(() => (tuners.data ? tunerMapOf(tuners.data) : undefined), [tuners.data]);
  const facets = useMemo(() => reserveFacets(list, now, tunerOf ? [...tunerOf.values()] : []), [list, now, tunerOf]);
  const shown = useMemo(() => filterReserves(list, s.filters, now, tunerOf), [list, s.filters, now, tunerOf]);
  const p = paginate(shown, s.page, pageSize);
  // 絞り込みを変えたらページを先頭へ
  const setFilters = (patch: Partial<ReserveFilters>) => set({ filters: { ...s.filters, ...patch }, page: 0 });
  const pager = <PagerBar page={p.page} totalPages={p.totalPages} totalCount={shown.length}
    onPrev={() => set({ page: p.page - 1 })} onNext={() => set({ page: p.page + 1 })} />;
  const f = s.filters;
  const open = (r: Reserve) => router.push({ pathname: '/reserve/[id]', params: { id: r.reserve_id } });

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} refreshControl={pullToRefresh(reserves, theme.mute)}>
        <TopBar title={tx('title.reservations')}
          right={
            <View style={styles.topRight}>
              <Pressable onPress={() => router.push('/autoreserve')}
                style={[styles.autoBtn, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                <T mono size={11} w={800}>{tx('reservations.list.auto')}</T>
              </Pressable>
              <Pressable onPress={() => router.push('/manual-reserve')}
                style={[styles.autoBtn, styles.manualBtn, { backgroundColor: accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                <Plus s={12} c="#fff" w={3} />
                <T mono size={11} w={800} color="#fff">{tx('reservations.list.manual')}</T>
              </Pressable>
              <IconButton title={tx('common.refetch')} onPress={() => void reserves.refetch()}><Refresh c={theme.ink} /></IconButton>
            </View>
          } />
        <View style={styles.stats}>
          {/* スキップは内訳（重複スキップ + それ以外）で出し、押した方だけを一覧に出す */}
          <StatStrip items={[
            { key: 'all', label: tx('filter.all'), v: facets.all, c: accent.primary, active: f.status === 'all',
              onPress: () => setFilters({ status: 'all', skip: 'all' }) },
            { key: 'sched', label: tx('reservations.list.stat.scheduled'), v: facets.scheduled, c: accent.tertiary, active: f.status === 'scheduled',
              onPress: () => setFilters({ status: 'scheduled', skip: 'all' }) },
            { key: 'skip', label: tx('reservations.list.stat.skip'), c: theme.mute, active: f.status === 'skip', parts: [
              { key: 'dup', label: tx('reservations.list.skipDupA11y'), v: facets.skipDup, c: DUP,
                active: f.status === 'skip' && f.skip === 'dup',
                onPress: () => setFilters({ status: 'skip', skip: f.status === 'skip' && f.skip === 'dup' ? 'all' : 'dup' }) },
              { key: 'other', label: tx('reservations.list.skipOtherA11y'), v: facets.skipOther, c: theme.mute,
                active: f.status === 'skip' && f.skip === 'other',
                onPress: () => setFilters({ status: 'skip', skip: f.status === 'skip' && f.skip === 'other' ? 'all' : 'other' }) },
            ] },
          ]} />
          <FilterToggle open={s.showFilters} count={activeReserveFilterCount(f)} onPress={() => set({ showFilters: !s.showFilters })} />
        </View>
        {reserves.error && (
          <View style={[styles.error, { backgroundColor: errorBox.bg, borderColor: errorBox.border }]}>
            <T mono size={11} color={errorBox.text}>{viewNode ? tx('common.nodeError', { node: viewNode, error: reserves.error.message }) : reserves.error.message}</T>
          </View>
        )}
        {s.showFilters && <ReserveFilterPanel facets={facets} f={f} set={setFilters} showTuner={!!tunerOf} />}
        <View style={styles.list}>
          {!reserves.data && !reserves.error ? <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>
            : p.totalPages <= 1 ? <T mono size={9} dim>{tx('common.count', { n: shown.length })}</T> : pager}
          {reserveView === 'table'
            ? <TableReserveList items={p.items} now={now} thumbOf={thumbOf} tunerOf={tunerOf} onOpen={open} onMenu={setMenu} />
            : reserveView === 'poster'
              // テロップは画像が主役なので、広い画面では並べる（1 枚が画面いっぱいに大きくならないように）
              ? <View style={styles.posters}>{p.items.map((r) => (
                <View key={r.reserve_id} style={styles.poster}>
                  <PosterReserveCard r={r} now={now} thumb={thumbOf(r)} tuner={tunerOf?.get(r.reserve_id)} onMenu={() => setMenu(r)} onPress={() => open(r)} />
                </View>
              ))}</View>
              : p.items.map((r) => (
                <ReserveCard key={r.reserve_id} r={r} now={now} thumb={thumbOf(r)} tuner={tunerOf?.get(r.reserve_id)} onMenu={() => setMenu(r)} onPress={() => open(r)} />
              ))}
          {p.totalPages > 1 && <View style={styles.bottomPager}>{pager}</View>}
        </View>
      </ScrollView>
      <ReserveActionSheet r={menu} onClose={() => setMenu(null)}
        onSkip={(r) => actions.skip.mutate(r.reserve_id)} onDelete={(r) => actions.remove.mutate(r.reserve_id)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  autoBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1.5 },
  manualBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  screen: { flex: 1 },
  content: { paddingBottom: 40 },
  stats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  error: { marginHorizontal: 18, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1 },
  list: { paddingHorizontal: 18, gap: 10 },
  bottomPager: { paddingTop: 6 },
  posters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  poster: { flexGrow: 1, flexBasis: 320, maxWidth: 560 },
  empty: { textAlign: 'center', padding: 40 },
});
