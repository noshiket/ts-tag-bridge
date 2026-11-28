import type { AlbumSummary, MsgKey } from '@tstag/core';
import { useAlbums, useMylist, useToggleMylist } from '@tstag/core/react';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlbumCard } from '../../../features/library/AlbumCard';
import { AlbumStacks } from '../../../features/library/views/AlbumStacks';
import { AlbumTiles } from '../../../features/library/views/AlbumTiles';
import { AllCapturesTab } from '../../../features/library/AllCapturesTab';
import { ContinueTab } from '../../../features/library/ContinueTab';
import { AlbumsTab, LocalTab, MylistTab } from '../../../features/library/home/AlbumListTabs';
import { LibrarySheets } from '../../../features/library/home/LibrarySheets';
import { Empty, ErrorBox } from '../../../features/library/home/libraryParts';
import { useLibraryState, type LibraryTab } from '../../../features/library/libraryState';
import { MomentumTab } from '../../../features/library/MomentumTab';
import { MusicTab } from '../../../features/library/music/MusicTab';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import { usePrivateMode } from '../../../lib/state/privateMode';
import { useViewNode } from '../../../lib/state/viewNode';
import { Tab } from '../../../ui/inputs/Chip';
import { More } from '../../../ui/parts/Icons';
import { pullToRefresh } from '../../../ui/gestures/PullToRefresh';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';
import { shadow } from '../../../ui/theme/edge';

/** 元の Web 版のタブ。まだ作っていないものも並べ、開くとその旨を出す */
const TABS: { k: LibraryTab; l: MsgKey; selfOnly?: boolean }[] = [
  { k: 'albums', l: 'library.tab.albums' },
  { k: 'mylist', l: 'library.tab.mylist', selfOnly: true },
  { k: 'music', l: 'library.tab.music' },
  { k: 'local', l: 'library.tab.local' },
  { k: 'continue', l: 'library.tab.continue' },
  { k: 'captures', l: 'library.tab.captures' },
  { k: 'momentum', l: 'library.tab.momentum' },
];

/** ライブラリ（元の library.jsx）。タブとシートは features/library/home */
export default function LibraryScreen() {
  useBgRenderCount('Library');
  const { theme, albumView } = useTheme();
  const { t: tx } = useT();
  const { viewNode } = useViewNode();
  const [s, set] = useLibraryState();
  const albums = useAlbums(viewNode);
  const mylist = useMylist();
  const toggleMylist = useToggleMylist();
  const [menuAlbum, setMenuAlbum] = useState<AlbumSummary | null>(null);
  const [libMenu, setLibMenu] = useState(false);
  const [, setPrivMode] = usePrivateMode();
  // ライブラリから離れたらプライベートモードを切る（元と同じ）
  useEffect(() => () => setPrivMode(false), [setPrivMode]);
  const tabs = TABS.filter((t) => !(t.selfOnly && viewNode));
  const tab = tabs.some((t) => t.k === s.tab) ? s.tab : 'albums';

  const openAlbum = (a: AlbumSummary) => router.push({ pathname: '/album/[id]', params: { id: a.id } });
  const myIds = mylist.data ?? [];
  const card = (a: AlbumSummary) => (
    <AlbumCard key={a.id} album={a} node={viewNode} onPress={() => openAlbum(a)} inMylist={myIds.includes(a.id)}
      onToggleMylist={viewNode ? undefined : (on) => toggleMylist.mutate({ albumId: a.id, on })}
      onMenu={viewNode ? undefined : () => setMenuAlbum(a)} />
  );
  // 表示の切り替え（標準はカード、タイル・重ねは長押しで操作のシート）
  const inMylist = (id: number) => myIds.includes(id);
  const list = (items: AlbumSummary[]) => albumView === 'tile'
    ? <AlbumTiles items={items} node={viewNode} inMylist={inMylist} onOpen={openAlbum} onMenu={viewNode ? undefined : setMenuAlbum} />
    : albumView === 'stack'
      ? <AlbumStacks items={items} node={viewNode} inMylist={inMylist} onOpen={openAlbum} onMenu={viewNode ? undefined : setMenuAlbum} />
      : items.map(card);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} refreshControl={pullToRefresh(albums, theme.mute)}>
        {/* 右上の「…」（動画追加・tagビデオ追加・音楽の取り込み・プライベートモード） */}
        <TopBar title={tx('title.library')} right={
          <Pressable onPress={() => setLibMenu(true)} accessibilityLabel={tx('library.menuA11y')}
            style={[styles.more, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: shadow(theme, 2) }]}>
            <More c={theme.ink} />
          </Pressable>
        } />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((t) => <Tab key={t.k} label={tx(t.l)} active={tab === t.k} onPress={() => set({ tab: t.k })} />)}
        </ScrollView>
        {albums.error && <ErrorBox message={albums.error.message} />}
        {tab === 'albums' && <AlbumsTab albums={albums.data} list={list} />}
        {tab === 'mylist' && <MylistTab albums={albums.data} ids={myIds} list={list} />}
        {tab === 'continue' && <ContinueTab />}
        {tab === 'momentum' && <MomentumTab />}
        {tab === 'captures' && <AllCapturesTab />}
        {tab === 'music' && <MusicTab />}
        {tab === 'local' && <LocalTab albums={albums.data} />}
        {!['albums', 'mylist', 'continue', 'momentum', 'captures', 'music', 'local'].includes(tab) && (
          <Empty>{tx('library.notYet')}</Empty>
        )}
      </ScrollView>
      <LibrarySheets libMenu={libMenu} closeLibMenu={() => setLibMenu(false)} menuAlbum={menuAlbum} setMenuAlbum={setMenuAlbum}
        inMylist={(id) => myIds.includes(id)} toggleMylist={(albumId, on) => toggleMylist.mutate({ albumId, on })} openAlbum={openAlbum} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  tabs: { gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  more: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
