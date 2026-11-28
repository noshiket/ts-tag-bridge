import {
  DEFAULT_SEARCH_QUERY, futureResults, pendingFromEvent, pendingFromSearch, isSkipped, parseSearchQuery, reserveByTitle, searchGenreLabel, searchParams, searchTimes,
  type EpgEvent, type SearchQuery,
} from '@tstag/core';
import { useApi, useReserves, useServices } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openNewAutoAdd } from '../../features/autoadd/pending';
import { ProgramSheet } from '../../features/epg/ProgramSheet';
import { searchGenreStyle } from '../../features/search/colors';
import { SearchPanel } from '../../features/search/SearchPanel';
import { TabBar } from '../../features/shell/TabBar';
import { deviceStore } from '../../lib/device/deviceStore';
import { useViewNode } from '../../lib/state/viewNode';
import { InputHistory } from '../../ui/inputs/HistoryInput';
import { Spark } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { T } from '../../ui/parts/T';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT, localizeFmt } from '../../ui/i18n/I18n';

const QUERY_KEY = 'tstag_search_query';
// 結果は2万件を超えることがあるので端末には残さず、アプリを開いている間だけ持つ（元と同じ）
let resultCache: { results: EpgEvent[]; page: number; futureOnly: boolean } | null = null;

/**
 * 番組検索（元の search.jsx の SearchScreen）。番組表の 🔍 から開く。見ているサーバーで検索・予約する。
 * 条件は端末に残し、結果は一覧（現在以降 / 全期間・ページ送り）。押すと番組の詳細から予約・スキップ。
 * 今の条件・番組から自動予約のルールを作れる（見ているサーバーに作る）
 */
export default function SearchScreen() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent, pageSize } = useTheme();
  const { viewNode } = useViewNode();
  const services = useServices(viewNode);
  const reserves = useReserves(viewNode);
  const [q, setQ] = useState<SearchQuery>(() => parseSearchQuery(deviceStore.get(QUERY_KEY)));
  const [results, setResults] = useState<EpgEvent[] | null>(() => resultCache?.results ?? null);
  const [searching, setSearching] = useState(false);
  const [futureOnly, setFutureOnly] = useState(() => resultCache?.futureOnly ?? true);
  const [page, setPage] = useState(() => resultCache?.page ?? 0);
  const [selected, setSelected] = useState<EpgEvent | null>(null);

  useEffect(() => { deviceStore.set(QUERY_KEY, JSON.stringify(q)); }, [q]);
  useEffect(() => { resultCache = results === null ? null : { results, page, futureOnly }; }, [results, page, futureOnly]);

  const run = async () => {
    setSearching(true);
    InputHistory.push('epg_and_key', q.andkey);
    InputHistory.push('epg_not_key', q.notkey);
    try {
      setResults(await api.epg.search(searchParams(q), viewNode));
    } catch {
      setResults([]);
    } finally {
      setPage(0);
      setSearching(false);
    }
  };
  const toAutoAdd = () => openNewAutoAdd(pendingFromSearch(q), viewNode);
  const clear = () => { setResults(null); setQ({ ...DEFAULT_SEARCH_QUERY }); };

  const list = reserves.data ?? [];
  const shown = results ? (futureOnly ? futureResults(results) : results) : [];
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, totalPages - 1);
  const pageItems = shown.slice(cur * pageSize, (cur + 1) * pageSize);

  // 詳細のシート（予約は題名で見る。元と同じ）
  const res = selected ? reserveByTitle(list, selected.title) : undefined;
  const skipped = !!res && isSkipped(res);
  const close = () => setSelected(null);
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); } finally { void qc.invalidateQueries({ queryKey: ['reserves', viewNode ?? ''] }); close(); }
  };
  const gs = selected ? searchGenreStyle(selected.content_nibble) : null;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TopBar title={tx('epg.search')} />
        <View style={styles.pad14}>
          <SearchPanel q={q} setQ={setQ} services={services.data} searching={searching} onSearch={() => void run()} onClear={clear}
            onConvertToAutoAdd={toAutoAdd} />
        </View>

        {results !== null && (
          <View style={styles.pad}>
            <View style={styles.countRow}>
              <T mono size={10} dim>{`${tx('common.count', { n: shown.length })}${totalPages > 1 ? ` (${cur + 1}/${totalPages})` : ''}`}</T>
              <Pressable onPress={toAutoAdd} style={[styles.toAuto, { backgroundColor: accent.secondary, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                <Spark s={10} c="#fff" />
                <T mono size={9} w={800} color="#fff">{tx('screens.search.goAutoReserve')}</T>
              </Pressable>
            </View>
            <View style={styles.when}>
              <Pill on={futureOnly} color={accent.primary} onPress={() => { setFutureOnly(true); setPage(0); }}>{tx('screens.search.now')}</Pill>
              <Pill on={!futureOnly} color={accent.secondary} onPress={() => { setFutureOnly(false); setPage(0); }}>{tx('screens.search.allTime', { v0: results.length })}</Pill>
            </View>

            <View style={styles.list}>
              {shown.length === 0 && <T size={13} dim style={styles.empty}>{tx('common.noMatches')}</T>}
              {pageItems.map((r, i) => {
                const isRes = !!reserveByTitle(list, r.title);
                const g = searchGenreStyle(r.content_nibble);
                const gl = searchGenreLabel(r.content_nibble);
                return (
                  <Pressable key={`${cur}-${i}`} onPress={() => setSelected(r)}
                    style={[styles.card, { backgroundColor: theme.surface, borderColor: isRes ? accent.primary : theme.cardFrame, boxShadow: shadow(theme, 2) }]}>
                    <View style={styles.meta}>
                      <View style={[styles.station, { backgroundColor: theme.surface2 }]}>
                        <T mono size={9} w={700} numberOfLines={1}>{r.station_name ?? ''}</T>
                      </View>
                      <T mono size={9} dim>{localizeFmt(searchTimes(r).list)}</T>
                      {!!gl && <Tag bg={g.bg} fg={g.ink}>{gl}</Tag>}
                      {r.free_ca === false && <Tag bg={oklch(0.78, 0.16, 210)} fg="#fff">{tx('epg.paid')}</Tag>}
                      {isRes && <Tag bg={accent.primary} fg="#fff" heavy>REC</Tag>}
                    </View>
                    <T size={13} w={700}>{r.title}</T>
                    {!!r.description && <T size={10} dim numberOfLines={2} style={styles.desc}>{r.description}</T>}
                  </Pressable>
                );
              })}
            </View>

            {totalPages > 1 && (
              <View style={styles.pager}>
                <PageBtn disabled={cur <= 0} onPress={() => setPage(Math.max(0, cur - 1))}>{tx('screens.search.prev')}</PageBtn>
                <T mono size={11} dim style={styles.pageNo}>{`${cur + 1} / ${totalPages}`}</T>
                <PageBtn disabled={cur >= totalPages - 1} onPress={() => setPage(Math.min(totalPages - 1, cur + 1))}>{tx('screens.search.next')}</PageBtn>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <ProgramSheet e={selected} node={viewNode} station={selected?.station_name} force={undefined}
        status={res ? (skipped ? 'skip' : 'rec') : undefined}
        timeLabel={selected ? localizeFmt(searchTimes(selected).sheet) : undefined}
        genre={selected && gs ? { ...gs, label: searchGenreLabel(selected.content_nibble) } : undefined}
        flags={false} fetchDetail={false}
        onClose={close}
        onReserve={res ? undefined : () => void act(() => api.epg.reserve(selected!, 1, viewNode, { rec_mode: 1, priority: 2 }))}
        onSkip={!skipped ? () => void act(() => (res ? api.reserves.skip(res.reserve_id, viewNode) : api.epg.reserve(selected!, 0, viewNode))) : undefined}
        onUnskip={skipped ? () => void act(() => api.reserves.unskip(res!.reserve_id, viewNode)) : undefined}
        onAutoAdd={selected ? () => { close(); openNewAutoAdd(pendingFromEvent(selected), viewNode); } : undefined} />
      <TabBar />
    </SafeAreaView>
  );
}

function Pill({ children, on, color, onPress }: { children: string; on: boolean; color: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: on ? color : 'transparent', borderColor: on ? color : theme.line }]}>
      <T mono size={10} w={700} color={on ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

function Tag({ children, bg, fg, heavy }: { children: string; bg: string; fg: string; heavy?: boolean }) {
  return <View style={[styles.tag, { backgroundColor: bg }]}><T size={8} w={heavy ? 800 : 700} color={fg}>{children}</T></View>;
}

function PageBtn({ children, disabled, onPress }: { children: string; disabled: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[styles.pageBtn, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2), opacity: disabled ? 0.4 : 1 }]}>
      <T mono size={11} w={800}>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  pad14: { paddingHorizontal: 18, paddingBottom: 14 },
  pad: { paddingHorizontal: 18 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  toAuto: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1.5 },
  when: { flexDirection: 'row', gap: 5, marginBottom: 10 },
  pill: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1.5 },
  list: { gap: 8 },
  empty: { textAlign: 'center', padding: 40 },
  card: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 4 },
  station: { paddingVertical: 1, paddingHorizontal: 6, borderRadius: 3, maxWidth: 100 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  desc: { marginTop: 3 },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 },
  pageBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1.5 },
  pageNo: { minWidth: 70, textAlign: 'center' },
});
