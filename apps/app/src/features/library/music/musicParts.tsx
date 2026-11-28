import { trackTitle, videoContextLabel, type Playlist, type Track } from '@tstag/core';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MusicLibrary } from './useMusicLibrary';
import { ResultMessage } from '../../../ui/parts/ResultMessage';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Sleeve } from './views/Sleeve';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** ジャケット（無ければ🎵） */
export function Cover({ m, uri, size, radius }: { m: MusicLibrary; uri: string | null; size: number; radius: number }) {
  const { theme } = useTheme();
  return uri
    ? <Image source={{ uri, headers: m.api.client.authHeaders() }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.surface2 }} contentFit="cover" cachePolicy="memory-disk" />
    : <View style={[styles.noImg, { width: size, height: size, borderRadius: radius, backgroundColor: theme.surface2, borderColor: theme.line }]}><T size={size > 50 ? 26 : 18}>🎵</T></View>;
}

/** 曲の1行: 押すと並び（list）を積んで再生。お気に入りは題名の前に ★（付け外しは「…」）。プレイリストの中なら ▲▼ 並べ替え、曲ごとの操作は「…」か長押し */
export function TrackRow({ m, v, list, onMove, onRemove }: { m: MusicLibrary; v: Track; list?: Track[]; onMove?: (v: Track, d: 'up' | 'down') => void; onRemove?: (v: Track) => void }) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const fav = m.favs.data?.has(v.id);
  return (
    <View style={[styles.track, { borderBottomColor: theme.line }]}>
      <Pressable onPress={() => m.playList(list ?? [v], v.id)} onLongPress={() => m.setTrackMenu({ v, onRemove })} style={styles.trackMain}>
        <Cover m={m} uri={m.api.music.coverUrl(v.id, m.node)} size={40} radius={6} />
        <View style={styles.grow}>
          <View style={styles.trackTitle}>
            {!!v.episode_number && <T mono size={9} dim>{v.episode_number}</T>}
            {fav && <T size={10} color={accent.primary}>★</T>}
            <T size={12} w={700} numberOfLines={1} style={styles.shrink}>{trackTitle(v)}</T>
          </View>
          <T mono size={9} dim numberOfLines={1}>{`${videoContextLabel(v)}${v.play_count ? ` · ${tx('library.music.plays', { n: v.play_count })}` : ''}`}</T>
        </View>
      </Pressable>
      {onMove && (
        <View style={styles.moves}>
          {(['up', 'down'] as const).map((d) => (
            <Pressable key={d} onPress={() => onMove(v, d)} accessibilityLabel={tx(d === 'up' ? 'library.music.up' : 'library.music.down')} style={[styles.move, { borderColor: theme.line }]}>
              <T size={8} dim>{d === 'up' ? '▲' : '▼'}</T>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable onPress={() => m.setTrackMenu({ v, onRemove })} accessibilityLabel={tx('common.menu')} style={[styles.icon, styles.iconBox, { borderColor: theme.line }]}>
        <T size={13}>…</T>
      </Pressable>
    </View>
  );
}

/** アーティスト・アルバム・プレイリストの1件（タイル表示はレコード棚のジャケット、リスト表示は右端に別のものを置ける） */
export function MusicItem({ m, title, sub, uri, onPress, right }: { m: MusicLibrary; title: string; sub: string; uri: string | null; onPress: () => void; right?: ReactNode }) {
  const { theme, musicView } = useTheme();
  if (musicView === 'grid') {
    return (
      <Pressable onPress={onPress} style={styles.gridCard}>
        <Sleeve m={m} uri={uri} />
        <T size={11} w={800} numberOfLines={1} style={styles.mt6}>{title}</T>
        {!!sub && <T mono size={9} dim numberOfLines={1}>{sub}</T>}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={[styles.listRow, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
      <Cover m={m} uri={uri} size={44} radius={8} />
      <View style={styles.grow}>
        <T size={13} w={700} numberOfLines={1}>{title}</T>
        <T mono size={9} dim>{sub}</T>
      </View>
      {right ?? <T size={13} dim>›</T>}
    </Pressable>
  );
}

/** 並べた件（タイルなら折り返して並べる） */
export function MusicGrid({ children }: { children: ReactNode }) {
  const { musicView } = useTheme();
  return <View style={musicView === 'grid' ? styles.grid : styles.listWrap}>{children}</View>;
}

/** プレイリスト1件（リストではフォルダへ移す・消すも出す） */
export function PlaylistItem({ m, p }: { m: MusicLibrary; p: Playlist }) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const sub = p.kind === 'folder' ? tx('library.music.folderSub', { n: m.pls.filter((x) => x.parent_id === p.id).length }) : `${tx('library.music.tracks', { n: p.item_count })}${p.last_played_at ? ` · ▶${p.last_played_at.slice(0, 16).replace('T', ' ')}` : ''}`;
  return (
    <MusicItem m={m} title={`${p.kind === 'folder' ? '📁 ' : ''}${p.name}`} sub={sub} uri={null}
      onPress={() => m.setDrill({ kind: p.kind === 'folder' ? 'folder' : 'playlist', id: p.id, name: p.name })}
      right={(
        <View style={styles.plActs}>
          <Pressable onPress={() => m.setMoveTarget(p)} accessibilityLabel={tx('library.music.moveToFolder')} style={[styles.icon, styles.iconBox, { borderColor: theme.line }]}><T size={11} dim>📁</T></Pressable>
          <Pressable onPress={() => void m.deletePlaylist(p)} accessibilityLabel={tx('common.delete')} style={[styles.icon, styles.iconBox, { borderColor: theme.line }]}><T size={11} dim>✕</T></Pressable>
        </View>
      )} />
  );
}

/** 空・読み込み中などの一言 */
export const Empty = ({ children }: { children: string }) => <T size={12} dim style={styles.empty}>{children}</T>;

/** 操作の結果の知らせ（成功は緑、失敗は赤） */
export function MusicMessage({ m }: { m: MusicLibrary }) {
  return <ResultMessage msg={m.msg} style={styles.msg} />;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  mt6: { marginTop: 6 },
  empty: { textAlign: 'center', padding: 30 },
  msg: { marginBottom: 10 },
  track: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  trackMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noImg: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  iconBox: { borderWidth: 1 },
  moves: { gap: 2 },
  move: { width: 24, height: 13, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // iOS は折り返しの行で縦横比の高さが伸ばしに負けるので、行の高さに合わせない
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 },
  gridCard: { width: '30%', flexGrow: 1, maxWidth: 160, minWidth: 96 },
  listWrap: { gap: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5 },
  plActs: { flexDirection: 'row', gap: 4 },
});
