import { sortPlaylists } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MusicChip, RepeatButton, ShuffleButton, ViewToggle, musicStyles as ms } from './musicControls';
import { Empty, MusicGrid, MusicItem, PlaylistItem, TrackRow } from './musicParts';
import { PurgeByName } from './PurgeByName';
import type { Drill, MusicLibrary } from './useMusicLibrary';
import { confirmAsync } from '../../../lib/device/confirm';
import { More } from '../../../ui/parts/Icons';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 掘り下げ: フォルダ（中のプレイリスト）、アーティスト（アルバムを並べる）、アルバム・プレイリスト（曲）。
 * 上に戻る・繰り返し・シャッフル・「…」（順番に再生・削除）。プレイリストの中だけ並べ替えと外す
 */
export function MusicDrill({ m, drill }: { m: MusicLibrary; drill: Drill }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const { api, node } = m;
  const [menu, setMenu] = useState(false);
  const [purge, setPurge] = useState(false);
  if (drill.kind === 'folder') {
    const children = sortPlaylists(m.pls.filter((p) => p.parent_id === drill.id), m.curSort('playlists'));
    return (
      <>
        <View style={styles.head}>
          <MusicChip active={false} onPress={() => m.setDrill(null)} label={tx('common.back2')} />
          <View style={ms.grow}><T size={13} w={800}>{`📁 ${drill.name}`}</T><T mono size={9} dim>{`${children.length}件`}</T></View>
          <ViewToggle />
        </View>
        {children.length ? <MusicGrid>{children.map((p) => <PlaylistItem key={p.id} m={m} p={p} />)}</MusicGrid> : <Empty>{tx('library.musicDrill.folderEmpty')}</Empty>}
      </>
    );
  }
  const data = m.drillQ.data;
  const list = data?.tracks ?? [];
  const label = drill.kind === 'artist' ? 'アーティスト' : drill.kind === 'album' ? 'アルバム' : tx('library.music.tab.playlists');
  const inPlaylist = drill.kind === 'playlist';
  return (
    <>
      <View style={styles.head}>
        <MusicChip active={false} onPress={() => m.setDrill(drill.parent ?? null)} label={`← ${drill.parent ? drill.parent.name : '戻る'}`} style={styles.back} />
        <View style={ms.grow}>
          <T size={13} w={800} numberOfLines={1}>{drill.name}</T>
          <T mono size={9} dim>{`${drill.sub ? `${drill.sub} · ` : ''}${drill.kind === 'artist' && data?.albums ? `${data.albums.length}アルバム · ` : ''}${list.length}曲`}</T>
        </View>
        {drill.kind === 'artist' && <ViewToggle />}
        <RepeatButton m={m} />
        <ShuffleButton m={m} list={list} />
        {/* 元はライブラリの「…」に出していた操作 */}
        <Pressable onPress={() => setMenu(true)} accessibilityLabel={tx('library.musicDrill.menu', { v0: label })} style={[styles.round, { borderColor: theme.line }]}><More s={12} c={theme.ink} /></Pressable>
      </View>
      {!data ? <Empty>{tx('common.loading')}</Empty> : drill.kind === 'artist' ? (
        !data.albums?.length ? <Empty>{tx('library.album.empty')}</Empty> : (
          <MusicGrid>
            {data.albums.map((a) => {
              const merged = m.albums.data?.find((x) => (x.series_ids ?? []).includes(a.series_id));
              return (
                <MusicItem key={a.series_id} m={m} title={a.name} sub={[a.year_at ? String(a.year_at).slice(0, 4) : '', tx('library.musicDrill.tracks', { v0: a.track_count })].filter(Boolean).join(' · ')}
                  uri={api.music.albumCoverUrl(a.series_id, a.updated_at, node)}
                  onPress={() => m.setDrill({ kind: 'album', id: a.series_id, ids: merged?.series_ids, name: a.name, sub: a.artist, parent: drill })} />
              );
            })}
          </MusicGrid>
        )
      ) : list.length ? list.map((v) => (
        <TrackRow key={`d${v.id}`} m={m} v={v} list={list}
          onMove={inPlaylist ? (x, d) => void m.moveInPlaylist(x, d) : undefined} onRemove={inPlaylist ? (x) => void m.removeFromPlaylist(x) : undefined} />
      )) : <Empty>{tx('library.music.noTracks')}</Empty>}

      <Sheet open={menu} onClose={() => setMenu(false)} title={drill.name}>
        <SheetItem first label={tx('library.musicDrill.shufflePlay')} sub={tx('library.musicDrill.shuffle', { v0: label, v1: drill.name })} onPress={() => { setMenu(false); m.shuffle(list); }} />
        <SheetItem label={tx('library.musicDrill.playOrder')} sub={tx('library.musicDrill.playTopCurrentOrder')} onPress={() => { setMenu(false); m.playList(list); }} />
        {inPlaylist
          ? <SheetItem danger label={tx('library.musicDrill.deletePlaylist')} sub={tx('library.musicDrill.tracksThemselvesArentDeleted')} onPress={async () => {
            setMenu(false);
            if (!(await confirmAsync(tx('library.musicDrill.deletePlaylist2', { v0: drill.name }), tx('reservations.list.sheet.delete')))) return;
            try { await api.music.deletePlaylist(drill.id); m.reload(); m.setDrill(null); } catch (e) { m.fail(e); }
          }} />
          : <SheetItem danger label={drill.kind === 'artist' ? tx('library.musicDrill.deleteWholeArtist') : tx('library.album.menu.delete')} sub={tx('library.musicDrill.deletesTracksTagJson')}
            onPress={() => { setMenu(false); setPurge(true); }} />}
      </Sheet>
      <PurgeByName open={purge} name={drill.name} count={list.length} onClose={() => setPurge(false)}
        run={async () => {
          const r = drill.kind === 'artist' ? await api.library.deleteAlbum(drill.id) : await api.music.deleteSeries(drill.id);
          m.setMsg({ ok: true, text: tx('library.musicDrill.deletedTracks', { v0: r.deleted }) });
          setPurge(false);
          m.setDrill(null);
          m.reload();
        }} />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  back: { maxWidth: '32%' },
  round: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
});
