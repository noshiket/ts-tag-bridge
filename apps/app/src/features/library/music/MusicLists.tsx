import { MUSIC_SORTS, sortPlaylists, type Artist, type Track } from '@tstag/core';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MusicChip, RepeatButton, ShuffleButton, ViewToggle, musicStyles as ms } from './musicControls';
import { Empty, MusicGrid, MusicItem, PlaylistItem, TrackRow } from './musicParts';
import { RecentShelf } from './views/RecentShelf';
import type { MTab, MusicLibrary } from './useMusicLibrary';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { trLabel, useT } from '../../../ui/i18n/I18n';

const TABS: MTab[] = ['recent', 'playlists', 'artists', 'albums', 'tracks', 'local'];

/** 曲の並びの見出し（件数・繰り返し・シャッフル）と曲の行 */
function TrackList({ m, list, head, prefix }: { m: MusicLibrary; list: Track[]; head: string; prefix: string }) {
  return (
    <>
      <View style={ms.secHead}><T mono size={10} dim style={ms.grow}>{head}</T><RepeatButton m={m} /><ShuffleButton m={m} list={list} /></View>
      {list.map((v) => <TrackRow key={`${prefix}${v.id}`} m={m} v={v} list={list} />)}
    </>
  );
}

/** ミュージックのタブの一覧: 最近の再生・よく聴く / プレイリスト / アーティスト / アルバム / 曲 / ローカル */
export function MusicLists({ m }: { m: MusicLibrary }) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const { tab, api, node, s } = m;
  const sorts = MUSIC_SORTS[tab];
  const gridable = tab === 'artists' || tab === 'albums' || tab === 'playlists';
  const ov = m.overview.data;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ms.chips}>
        {TABS.map((k) => <MusicChip key={k} active={tab === k} onPress={() => m.set({ tab: k, drill: null })} label={tx(`library.music.tab.${k}`)} />)}
      </ScrollView>
      {(sorts || gridable) && (
        <View style={styles.sortRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ms.chips}>
            {(sorts ?? []).map(([k, l]) => <MusicChip key={k} active={m.curSort(tab) === k} onPress={() => m.set({ sort: { ...s.sort, [tab]: k } })} label={trLabel(tx, 'library.musicSort', k, { [k]: l })} />)}
          </ScrollView>
          {gridable && <ViewToggle />}
        </View>
      )}

      {tab === 'recent' && (!ov ? <Empty>{tx('common.loading')}</Empty> : (
        <>
          <RecentShelf m={m} recent={ov.recent ?? []} top={ov.top ?? []} />
          {!ov.recent?.length && !ov.top?.length && <Empty>{tx('library.music.noPlays')}</Empty>}
        </>
      ))}

      {tab === 'artists' && (!m.artists.data ? <Empty>{tx('common.loading')}</Empty> : !m.artists.data.length ? <Empty>{tx('library.music.noMusic')}</Empty> : (
        <MusicGrid>
          {m.artists.data.map((a: Artist) => (
            <MusicItem key={a.id} m={m} title={a.name} sub={tx('library.music.tracks', { n: a.video_count })} uri={api.music.artistCoverUrl(a.id, a.latest_video_updated_at, node)}
              onPress={() => m.setDrill({ kind: 'artist', id: a.id, name: a.name })} />
          ))}
        </MusicGrid>
      ))}

      {tab === 'albums' && (!m.albums.data ? <Empty>{tx('common.loading')}</Empty> : !m.albums.data.length ? <Empty>{tx('library.music.noAlbums')}</Empty> : (
        <MusicGrid>
          {m.albums.data.map((a) => (
            <MusicItem key={a.series_id} m={m} title={a.name} sub={[a.artist, a.year_at ? String(a.year_at).slice(0, 4) : '', tx('library.music.tracks', { n: a.track_count })].filter(Boolean).join(' · ')}
              uri={api.music.albumCoverUrl(a.series_id, a.updated_at, node)} onPress={() => m.setDrill({ kind: 'album', id: a.series_id, ids: a.series_ids, name: a.name, sub: a.artist })} />
          ))}
        </MusicGrid>
      ))}

      {tab === 'tracks' && (!m.tracks.data ? <Empty>{tx('common.loading')}</Empty>
        : !m.tracks.data.length ? <Empty>{tx(m.curSort('tracks') === 'favorite' ? 'library.music.noFavorites' : 'library.music.noTracks')}</Empty>
        : <TrackList m={m} list={m.tracks.data} head={tx('library.music.tracks', { n: m.tracks.data.length })} prefix="a" />)}

      {tab === 'playlists' && (!m.playlists.data ? <Empty>{tx('common.loading')}</Empty> : (
        <>
          <View style={ms.newRow}>
            <TextInput value={m.newName} onChangeText={m.setNewName} placeholder={tx('library.music.newPlaylist')} placeholderTextColor={theme.mute}
              style={[ms.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
            {(['playlist', 'folder'] as const).map((kind) => (
              <Pressable key={kind} onPress={() => void m.createPlaylist(kind)}
                style={[ms.make, { borderColor: theme.line, borderWidth: 1, backgroundColor: kind === 'playlist' ? accent.primary : 'transparent' }]}>
                <T mono size={11} w={800} color={kind === 'playlist' ? '#fff' : theme.ink}>{tx(kind === 'playlist' ? 'library.music.create' : 'library.music.newFolder')}</T>
              </Pressable>
            ))}
          </View>
          {/* フォルダの中身はフォルダを開いて見る（ここは一番上だけ） */}
          {!m.pls.length ? <Empty>{tx('library.music.noPlaylists')}</Empty>
            : <MusicGrid>{sortPlaylists(m.pls.filter((p) => p.parent_id == null), m.curSort('playlists')).map((p) => <PlaylistItem key={p.id} m={m} p={p} />)}</MusicGrid>}
        </>
      ))}

      {tab === 'local' && (!m.localTracks.data ? <Empty>{m.localTracks.error ? (m.localTracks.error as Error).message : tx('common.loading')}</Empty>
        : !m.localTracks.data.length ? <Empty>{tx('library.music.noLocal')}</Empty>
        : <TrackList m={m} list={m.localTracks.data} head={tx('library.music.tracks', { n: m.localTracks.data.length })} prefix="l" />)}
    </>
  );
}

const styles = StyleSheet.create({
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 10 },
});
