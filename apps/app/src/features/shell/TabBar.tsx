import { canScreen, reserveStatus, type MsgKey, type ScreenId } from '@tstag/core';
import { useEncodes, useMe, useNodes, useReserves } from '@tstag/core/react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useRef, type ComponentType } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cal, Gear, Hist, Queue, ServerIcon, TagIcon } from '../../ui/parts/Icons';
import { serverCycle, useViewNode } from '../../lib/state/viewNode';
import { MiniPlayerBar } from './MiniPlayerBar';
import { activeItems, useLocalSaveSelect } from '../../lib/localSave/store';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';

/** この幅からは PC の並び（左に縦の帯。元の Web 版と同じ境目） */
export const PC_WIDTH = 900;
export const useIsPC = () => useWindowDimensions().width >= PC_WIDTH;

/** ナビの並び（元の Web 版の TabBar / DesktopSidebar と同じ並び・名前）。開けない画面は出さない。名前は表示言語の辞書から */
export const NAV_TABS: { id: ScreenId; path: string; label: MsgKey; Icon: ComponentType<{ s?: number; c: string }> }[] = [
  { id: 'epg', path: '/epg', label: 'nav.epg', Icon: Cal },
  { id: 'reservations', path: '/reservations', label: 'nav.reservations', Icon: TagIcon },
  { id: 'recresult', path: '/recresult', label: 'nav.recresult', Icon: Hist },
  { id: 'library', path: '/', label: 'nav.library', Icon: Queue },
  { id: 'settings', path: '/settings', label: 'nav.settings', Icon: Gear },
];

/** その画面のときに光らせるか（詳細や編集の画面は、そこへ来たタブを光らせる。元と同じ） */
const isActive = (id: ScreenId, path: string, tabPath: string) => path === tabPath
  // アルバム・カテゴリの中もライブラリ（元はライブラリの画面の中でアルバムを開く）。押すと一覧へ戻る
  || (id === 'library' && (path.startsWith('/album/') || path.startsWith('/category/')))
  || (id === 'reservations' && (path.startsWith('/reserve/') || path === '/manual-reserve'))
  || (id === 'recresult' && (path.startsWith('/recording/') || path.startsWith('/encoding/')))
  || (id === 'settings' && path === '/patterns');

/** ナビの項目（見せる分・光らせ方・件数の印）。下のタブと PC の縦の帯で同じものを使う */
export function useNavItems() {
  useBgRenderCount('Nav');
  const { accent } = useTheme();
  const { t: tx } = useT();
  const me = useMe().data;
  const path = usePathname();
  const { viewNode } = useViewNode();
  // 予約＝録画中の本数、録画結果＝エンコードの実行中＋待機の本数（見ているサーバーのもの。元と同じ）
  const reserves = useReserves(viewNode, canScreen(me, 'reservations'));
  const encodes = useEncodes(viewNode, canScreen(me, 'recresult'));
  const now = Date.now();
  // ライブラリ＝この端末で保存中・待機中の本数（どのサーバーの分も。元と同じ）
  const saving = useLocalSaveSelect((s) => activeItems(s).length);
  const badge: Partial<Record<ScreenId, { n: number; c: string; pulse?: boolean }>> = {
    reservations: { n: (reserves.data ?? []).filter((r) => reserveStatus(r, now) === 'recording').length, c: '#e53e3e' },
    recresult: { n: (encodes.data ?? []).filter((e) => e.status === 'running' || e.status === 'queued').length, c: accent.primary },
    library: { n: saving, c: accent.primary, pulse: saving > 0 },
  };
  const items = NAV_TABS.filter((t) => canScreen(me, t.id)).map((t) => ({ ...t, label: tx(t.label), active: isActive(t.id, path, t.path), badge: badge[t.id] }));
  const go = (p: string) => { if (path !== p) router.navigate(p as never); };
  return { items, path, go };
}

export function TabBar() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isPC = useIsPC();
  const { items, path, go } = useNavItems();
  const ring = theme.isDark ? 'rgba(14,11,20,0.92)' : 'rgba(255,255,255,0.92)';
  // PC の幅では左の縦の帯（DesktopSidebar）がナビなので、ここはミニプレイヤーの帯だけ（元と同じ）
  if (isPC) return <MiniPlayerBar />;
  return (
    <View>
    <MiniPlayerBar />
    <View style={[styles.bar, {
      backgroundColor: ring,
      borderTopColor: theme.line, paddingBottom: Math.max(insets.bottom, 12),
    }]}>
      {items.map((t) => {
        const color = t.active ? theme.ink : theme.mute;
        return (
          <Pressable key={t.id} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: t.active }}
            onPress={() => go(t.path)}>
            <View>
              <t.Icon s={20} c={color} />
              {t.badge && <NavBadge {...t.badge} ring={ring} />}
            </View>
            <T size={10} w={700} color={color} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t.label}</T>
          </Pressable>
        );
      })}
      <ServerTab ring={ring} path={path} />
    </View>
    </View>
  );
}

/**
 * サーバーを切り替えてよい画面（元で上に NodeSwitcher があった一覧の画面）。
 * 予約の詳細や自動予約の編集など、あるサーバーの1件を見る・直す画面では切り替えない
 * （どのサーバーを更新するか分からなくなるため）。そこでは今のサーバーを示すだけにする
 */
const SWITCH_PATHS = new Set(['/epg', '/reservations', '/recresult', '/', '/settings', '/search', '/autoreserve']);
/** 見ているサーバーに関わらず自サーバーを読み書きする画面（手動予約の追加・パターン） */
const LOCAL_PATHS = new Set(['/manual-reserve', '/patterns']);
/** URL で指定したサーバーのものを開く画面（自動予約・手動予約の編集） */
const PARAM_NODE = (path: string) => path.startsWith('/autoadd/') || path.startsWith('/manuadd/');

/**
 * 見るサーバーの切り替え（元は各画面の上の NodeSwitcher。押しづらいのでナビへ移した）。
 * 1 が自サーバー、2 からが連携先。押すたびに次のサーバーへ替わる。他のサーバーが無ければ null
 */
export function useServerSwitch(path: string) {
  const nodes = useNodes();
  const peers = nodes.data?.nodes ?? [];
  const { viewNode, setViewNode } = useViewNode();
  // 見ているサーバーが見てよい一覧から外れたら（管理者が権限を外した等）、自サーバーへ戻す。
  // 戻さないと、他のサーバーが無くなって切り替えのボタンも消え、何も見られないまま戻れなかった
  useEffect(() => {
    if (nodes.data && viewNode && !nodes.data.nodes.some((n) => n.name === viewNode)) setViewNode(null);
  }, [nodes.data, viewNode, setViewNode]);
  const params = useGlobalSearchParams<{ node?: string }>();
  const { t: tx } = useT();
  if (!peers.length) return null;
  const canSwitch = SWITCH_PATHS.has(path);
  // 切り替えない画面では、その画面が実際に読み書きするサーバーを出す
  const pageNode = LOCAL_PATHS.has(path) ? null : PARAM_NODE(path) ? (params.node || null) : (viewNode ?? null);
  const { list, i, next } = serverCycle(peers, pageNode);
  const name = list[i] ?? tx('nav.ownServer');
  return {
    canSwitch, name, num: i + 1, other: i > 0,
    label: canSwitch ? tx('nav.switchServer', { name }) : tx('nav.fixedServer', { name }),
    next: () => setViewNode(next),
  };
}

/** サーバーの印と番号（下のタブと PC の縦の帯で同じもの） */
export function ServerMark({ num, other, ring, s = 20 }: { num: number; other: boolean; ring: string; s?: number }) {
  const { theme, accent } = useTheme();
  return (
    <View>
      <ServerIcon s={s} c={other ? accent.primary : theme.mute} />
      <View style={[styles.num, { backgroundColor: other ? accent.primary : theme.ink, borderColor: ring }]}>
        <T mono size={9} w={800} color={other ? '#fff' : theme.bg} style={styles.numText}>{String(num)}</T>
      </View>
    </View>
  );
}

function ServerTab({ ring, path }: { ring: string; path: string }) {
  const { theme, accent } = useTheme();
  const sv = useServerSwitch(path);
  if (!sv) return null;
  const color = sv.other ? accent.primary : theme.mute;
  return (
    <Pressable style={[styles.tab, !sv.canSwitch && styles.locked]} disabled={!sv.canSwitch}
      accessibilityRole={sv.canSwitch ? 'button' : 'text'} accessibilityLabel={sv.label} onPress={sv.next}>
      <ServerMark num={sv.num} other={sv.other} ring={ring} />
      <T size={10} w={700} color={color} numberOfLines={1} style={styles.name}>{sv.name}</T>
    </Pressable>
  );
}

/** タブの右上の点と件数（2件から数を出す。元の NavBadge） */
export function NavBadge({ n, c, ring, pulse }: { n: number; c: string; ring: string; pulse?: boolean }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) { op.setValue(1); return; }
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [pulse, op]);
  if (n < 1) return null;
  return (
    <>
      <Animated.View style={[styles.dot, { backgroundColor: c, borderColor: ring, opacity: op }]} />
      {n >= 2 && <T mono size={9} w={800} color={c} style={styles.count}>{n > 99 ? '99+' : String(n)}</T>}
    </>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  count: { position: 'absolute', bottom: -6, right: -7, lineHeight: 9 },
  bar: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingHorizontal: 2, borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  num: { position: 'absolute', right: -9, bottom: -5, minWidth: 14, height: 14, paddingHorizontal: 2, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  numText: { lineHeight: 10 },
  locked: { opacity: 0.45 },
  name: { maxWidth: '100%' },
});
