import type { MsgKey } from '@tstag/core';
import { DOW_LABELS, autoAddCardSummary, hasDow, manuAddTimes, paginate, type AutoAddRule, type ManuAddRaw } from '@tstag/core';
import { useAutoAdd, useManuAdd } from '@tstag/core/react';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openNewAutoAdd } from '../../features/autoadd/pending';
import { TabBar } from '../../features/shell/TabBar';
import { useViewNode } from '../../lib/state/viewNode';
import { Chev, Plus } from '../../ui/parts/Icons';
import { PagerBar } from '../../ui/parts/PagerBar';
import { pullToRefresh } from '../../ui/gestures/PullToRefresh';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { Mark } from '../../ui/parts/Mark';
import { T } from '../../ui/parts/T';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

type Tab = 'epg' | 'manu';
const TABS: [Tab, MsgKey][] = [['epg', 'screens.autoreserve.keyword'], ['manu', 'screens.autoreserve.programReserve']];

/**
 * 自動予約（元の auto_reserve.jsx の AutoReserveScreen）。予約一覧の「自動予約」から開く。
 * EPG キーワード（配信の局のルールも並ぶ）とプログラム予約の2つのタブ。見ているサーバーのルールを出し、押すと編集
 */
export default function AutoReserveScreen() {
  const { t: tx } = useT();
  const { theme, pageSize } = useTheme();
  const { viewNode } = useViewNode();
  const autoAdd = useAutoAdd(viewNode);
  const manuAdd = useManuAdd(viewNode);
  const [tab, setTab] = useState<Tab>('epg');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [tab, viewNode, pageSize]); // タブ・サーバー・件数を変えたら先頭へ

  const rows: (AutoAddRule | ManuAddRaw)[] = (tab === 'epg' ? autoAdd.data : manuAdd.data) ?? [];
  const p = paginate(rows, page, pageSize);
  const pager = <PagerBar page={p.page} totalPages={p.totalPages} totalCount={rows.length}
    onPrev={() => setPage(p.page - 1)} onNext={() => setPage(p.page + 1)} />;
  const q = tab === 'epg' ? autoAdd : manuAdd;
  const nodeParam = viewNode ? { node: viewNode } : {};

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} refreshControl={pullToRefresh(q, theme.mute)}>
        <TopBar title={tx('reservations.list.auto')} />
        <View style={styles.pad}>
          <View style={[styles.tabs, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {TABS.map(([k, l]) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: tab === k ? theme.ink : 'transparent' }]}>
                <T mono size={10} w={700} color={tab === k ? theme.onInk : theme.mute}>{tx(l)}</T>
              </Pressable>
            ))}
          </View>

          <SectionTitle>{tab === 'epg'
            ? `${tx('autoReserve.list.epgHead')} / GET /api/auto_add${viewNode ? ` (@${viewNode})` : ''}`
            : `${tx('screens.autoreserve.programReserve')} / GET /api/manu_add${viewNode ? ` (@${viewNode})` : ''}`}</SectionTitle>
          <View style={styles.list}>
            {pager}
            {tab === 'epg'
              ? (p.items as AutoAddRule[]).map((a) => (
                <AutoAddCard key={a.id} a={a} onPress={() => router.push({ pathname: '/autoadd/[id]', params: { id: String(a.id), ...nodeParam } })} />
              ))
              : (p.items as ManuAddRaw[]).map((m) => (
                <ManuAddCard key={m.id} m={m} onPress={() => router.push({ pathname: '/manuadd/[id]', params: { id: String(m.id), ...nodeParam } })} />
              ))}
            {q.data && rows.length === 0 && <T size={12} dim style={styles.empty}>{tx('screens.autoreserve.noRules')}</T>}
            {q.error && <T size={12} dim style={styles.empty}>{q.error.message}</T>}
            {!q.data && !q.error && <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}
            {pager}
          </View>
          <Pressable onPress={() => (tab === 'epg' ? openNewAutoAdd(null, viewNode)
            : router.push({ pathname: '/manuadd/[id]', params: { id: 'new', ...nodeParam } }))}
            style={[styles.add, { borderColor: theme.frame }]}>
            <Plus s={14} c={theme.ink} w={2.5} />
            <T size={12} w={700}>{tab === 'epg' ? tx('screens.autoreserve.addRule') : tx('screens.autoreserve.addRule2')}</T>
          </Pressable>
        </View>
      </ScrollView>
      <TabBar />
    </SafeAreaView>
  );
}

function Badge({ children, bg, fg, mono = true, bold = true }: { children: ReactNode; bg: string; fg: string; mono?: boolean; bold?: boolean }) {
  return <Mark bg={bg} fg={fg} style={styles.badge}>{(c) => <T mono={mono} size={8} w={bold ? 700 : 400} color={c}>{children}</T>}</Mark>;
}

function Card({ children, onPress, dim }: { children: ReactNode; onPress: () => void; dim?: boolean }) {
  const { theme } = useTheme();
  const c = dim ? theme.line : theme.frame;
  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: theme.surface, borderColor: c, boxShadow: shadow(theme, 3, c), opacity: dim ? 0.5 : 1 }]}>
      {children}
    </Pressable>
  );
}

/** EPG キーワードのルール（元の AutoAddCard） */
function AutoAddCard({ a, onPress }: { a: AutoAddRule; onPress: () => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  return (
    <Card onPress={onPress} dim={a.disableFlag}>
      <View style={styles.head}>
        <Badge bg={theme.surface2} fg={theme.mute} bold={false}>{`id:${a.id}`}</Badge>
        {!!a.addon && <Badge bg={accent.primary} fg="#fff">{tx('screens.autoreserve.streaming')}</Badge>}
        {a.disableFlag && <Badge bg={theme.surface2} fg={theme.mute}>{tx('common.off')}</Badge>}
        {a.titleOnlyFlag && <Badge bg={accent.secondary} fg="#fff">{tx('screens.autoreserve.titleOnly')}</Badge>}
        {a.aimaiFlag && <Badge bg={accent.tertiary} fg="#fff">{tx('common.fuzzy')}</Badge>}
        {a.addCount > 0 && <Badge bg={`${accent.primary}33`} fg={accent.primary}>{`×${a.addCount}`}</Badge>}
        <View style={styles.grow} />
        <Chev s={10} c={theme.mute} />
      </View>
      <T size={15} w={800} style={{ marginBottom: a.notKey ? 3 : 5 }}>{a.andKey || '—'}</T>
      {!!a.notKey && <T size={11} dim style={styles.mb5}>{`NOT: ${a.notKey}`}</T>}
      <T mono size={9} dim>{autoAddCardSummary(a)}</T>
    </Card>
  );
}

/** プログラム予約のルール（元の ManuAddCard） */
function ManuAddCard({ m, onPress }: { m: ManuAddRaw; onPress: () => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const t = manuAddTimes(m);
  return (
    <Card onPress={onPress}>
      <View style={styles.head}>
        <Badge bg={theme.surface2} fg={theme.mute} bold={false}>{`id:${m.id}`}</Badge>
        {!!m.station_name && <Badge bg={`${accent.tertiary}33`} fg={accent.tertiary}>{m.station_name}</Badge>}
        <View style={styles.grow} />
        <Chev s={10} c={theme.mute} />
      </View>
      <T size={15} w={800} style={styles.mb5}>{m.title || tx('library.video.noTitle')}</T>
      <T mono size={11} dim style={styles.mb7}>{tx('screens.autoreserve.min', { v0: t.start, v1: t.end, v2: t.durationMin })}</T>
      <View style={styles.dows}>
        {DOW_LABELS.map((d, bit) => {
          const on = hasDow(m.day_of_week_flag || 0, bit);
          return (
            <View key={d} style={[styles.dow, { backgroundColor: on ? accent.primary : theme.surface2, borderColor: theme.line }]}>
              <T size={9} w={800} color={on ? '#fff' : theme.mute}>{d}</T>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  pad: { paddingHorizontal: 18 },
  tabs: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10, borderWidth: 1, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 7, alignItems: 'center' },
  list: { gap: 10, marginBottom: 12 },
  empty: { padding: 20, textAlign: 'center' },
  add: { padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  card: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7 },
  badge: { paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3 },
  grow: { flex: 1 },
  mb5: { marginBottom: 5 },
  mb7: { marginBottom: 7 },
  dows: { flexDirection: 'row', gap: 3 },
  dow: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
