import { activeRecFilterCount, type RecFilters, type Recording } from '@tstag/core';
import { useRecordings, useRemoveRecording } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EncodeTab } from '../../../features/recresult/EncodeTab';
import { RecDeleteSheet } from '../../../features/recresult/RecDeleteSheet';
import { RecFilterPanel } from '../../../features/recresult/RecFilterPanel';
import { RecordingCard } from '../../../features/recresult/RecordingCard';
import { ContactSheet } from '../../../features/recresult/sheet/ContactSheet';
import { QcList } from '../../../features/recresult/qc/QcList';
import { ManualAddForm } from '../../../features/recresult/ManualAddForm';
import { useRecResultState } from '../../../features/recresult/state';
import { useViewNode } from '../../../lib/state/viewNode';
import { FilterToggle } from '../../../ui/inputs/FilterToggle';
import { Plus } from '../../../ui/parts/Icons';
import { PagerBar } from '../../../ui/parts/PagerBar';
import { pullToRefresh } from '../../../ui/gestures/PullToRefresh';
import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import { shadow } from '../../../ui/theme/edge';


/**
 * 録画結果（元の recresult.jsx）。絞り込み・ページはサーバーが行う。
 * 録画結果のタブでは右上の＋で TS を手で登録できる
 */
export default function RecResultScreen() {
  useBgRenderCount('RecResult');
  const { theme, pageSize, recView } = useTheme();
  const { t: tx } = useT();
  const { viewNode } = useViewNode();
  const [s, set] = useRecResultState();
  const recs = useRecordings(s.filters, s.page, pageSize, viewNode);
  const remove = useRemoveRecording(viewNode);
  const [deleting, setDeleting] = useState<Recording | null>(null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const total = recs.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(s.page, totalPages - 1);
  // 絞り込みを変えたらページを先頭へ
  const setFilters = (patch: Partial<RecFilters>) => set({ filters: { ...s.filters, ...patch }, page: 0 });
  const pager = <PagerBar page={page} totalPages={totalPages} totalCount={total}
    onPrev={() => set({ page: page - 1 })} onNext={() => set({ page: page + 1 })} />;
  // 条件を変えて取り直している間は前の一覧を薄く出す（元と同じ）
  const loading = recs.isFetching && recs.isPlaceholderData;
  const open = (r: Recording) => router.push({ pathname: '/recording/[id]', params: { id: r.db_rec_id! } });

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} refreshControl={pullToRefresh(recs, theme.mute)} keyboardShouldPersistTaps="handled">
        <TopBar title={tx('title.recresult')} right={s.tab === 'rec' ? (
          <Pressable onPress={() => setAdding((v) => !v)} accessibilityLabel={tx('recresult.rec.manualAdd')}
            style={[styles.plus, { backgroundColor: adding ? theme.ink : theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
            <Plus s={14} c={adding ? theme.onInk : theme.ink} />
          </Pressable>
        ) : undefined} />
        <View style={styles.segWrap}>
          <View style={[styles.seg, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {([['rec', 'recresult.tab.rec'], ['encode', 'recresult.tab.encode']] as const).map(([k, l]) => (
              <Pressable key={k} onPress={() => set({ tab: k })} style={[styles.segBtn, { backgroundColor: s.tab === k ? theme.ink : 'transparent' }]}>
                <T mono size={11} w={700} color={s.tab === k ? theme.onInk : theme.mute}>{tx(l)}</T>
              </Pressable>
            ))}
          </View>
        </View>
        {recs.error && (
          <View style={[styles.error, { backgroundColor: errorBox.bg, borderColor: errorBox.border }]}>
            <T mono size={11} color={errorBox.text}>{viewNode ? tx('common.nodeError', { node: viewNode, error: recs.error.message }) : recs.error.message}</T>
          </View>
        )}
        {adding && s.tab === 'rec' && (
          <ManualAddForm node={viewNode} onClose={() => setAdding(false)}
            onAdded={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['recordings', viewNode ?? ''] }); }} />
        )}
        {s.tab === 'encode' ? (
          <EncodeTab node={viewNode} />
        ) : (
          <>
            <View style={styles.toggleRow}>
              <FilterToggle open={s.showFilters} count={activeRecFilterCount(s.filters)} onPress={() => set({ showFilters: !s.showFilters })} />
            </View>
            {s.showFilters && <RecFilterPanel summary={recs.data?.summary ?? {}} f={s.filters} set={setFilters} />}
            <View style={styles.pagerTop}>{totalPages <= 1 ? <T mono size={9} dim>{tx('common.count', { n: total })}</T> : pager}</View>
            <View style={[styles.list, { opacity: loading ? 0.45 : 1 }]} pointerEvents={loading ? 'none' : 'auto'}>
              {!recs.data && !recs.error && <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}
              {recs.data && total === 0 && !loading && <T size={13} dim style={styles.empty}>{tx('recresult.rec.empty')}</T>}
              {recView === 'sheet' && recs.data && recs.data.items.length > 0
                ? <ContactSheet items={recs.data.items} node={viewNode} onDelete={setDeleting} onOpen={open} />
                : recView === 'qc' && recs.data && recs.data.items.length > 0
                ? <QcList items={recs.data.items} node={viewNode} onDelete={setDeleting} onOpen={open} />
                : recs.data?.items.map((r) => (
                  <RecordingCard key={r.db_rec_id ?? `e${r.id}`} r={r} node={viewNode} onDelete={() => setDeleting(r)}
                    onOpen={r.db_rec_id != null ? () => open(r) : undefined} />
                ))}
            </View>
            {totalPages > 1 && <View style={styles.pagerBottom}>{pager}</View>}
          </>
        )}
      </ScrollView>
      <RecDeleteSheet r={deleting} onClose={() => setDeleting(null)} onDelete={(r, keepEdcb) => remove.mutate({ r, keepEdcb })} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  plus: { width: 34, height: 34, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 40 },
  segWrap: { paddingHorizontal: 18, paddingBottom: 12 },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 12, borderWidth: 1, gap: 2 },
  segBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center' },
  error: { marginHorizontal: 18, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 8 },
  pagerTop: { paddingHorizontal: 18, paddingBottom: 10 },
  list: { paddingHorizontal: 18, gap: 10 },
  pagerBottom: { paddingTop: 18, paddingHorizontal: 18 },
  empty: { textAlign: 'center', padding: 40 },
});
