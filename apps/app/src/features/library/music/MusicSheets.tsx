import { localSaveMetaOf, trackTitle } from '@tstag/core';
import { Pressable, TextInput, View } from 'react-native';

import { musicStyles as ms } from './musicControls';
import { Empty } from './musicParts';
import type { MusicLibrary } from './useMusicLibrary';
import { TagJsonSheet } from '../TagJsonSheet';
import { confirmAsync } from '../../../lib/device/confirm';
import { localSave, localStateOf } from '../../../lib/localSave/store';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** ミュージックのシート: プレイリストへ追加、曲の「…」、tag.json、プレイリストをフォルダへ移す */
export function MusicSheets({ m }: { m: MusicLibrary }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { api, node, addTo, trackMenu, moveTarget, pls } = m;
  const done = (text: string) => { m.reload(); m.setMsg({ ok: true, text }); };
  const addToPlaylist = async (id: number, name: string) => {
    if (!addTo) return;
    try { await api.music.addItems(id, [addTo.id]); m.setAddTo(null); done(tx('library.musicSheets.added', { v0: name })); } catch (e) { m.fail(e); }
  };
  return (
    <>
      <Sheet open={!!addTo} onClose={() => m.setAddTo(null)} title={tx('library.musicSheets.addPlaylist', { v0: addTo ? trackTitle(addTo) : '' })}>
        <View style={ms.newRow}>
          <TextInput value={m.newName} onChangeText={m.setNewName} placeholder={tx('library.music.newPlaylist')} placeholderTextColor={theme.mute}
            style={[ms.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
          <Pressable onPress={async () => {
            const name = m.newName.trim();
            if (!name || !addTo) return;
            try { const pl = await api.music.createPlaylist(name, 'playlist'); m.setNewName(''); await addToPlaylist(pl.id, name); } catch (e) { m.fail(e); }
          }} style={[ms.make, { backgroundColor: accent.primary }]}><T size={12} w={800} color="#fff">{tx('library.musicSheets.create')}</T></Pressable>
        </View>
        {pls.filter((p) => p.kind !== 'folder').map((p) => (
          <Pressable key={p.id} onPress={() => void addToPlaylist(p.id, p.name)} style={[ms.plPick, { borderColor: theme.line }]}>
            <T size={12}>{p.name}<T mono size={9} dim>{tx('library.musicSheets.tracks', { v0: p.item_count })}</T></T>
          </Pressable>
        ))}
        {!pls.some((p) => p.kind !== 'folder') && <Empty>{tx('library.music.noPlaylists')}</Empty>}
      </Sheet>

      {/* 曲の「…」 */}
      <Sheet open={!!trackMenu} onClose={() => m.setTrackMenu(null)} title={trackMenu ? trackTitle(trackMenu.v) : ''}
        subtitle={trackMenu ? [trackMenu.v.album_name, trackMenu.v.series_name].filter(Boolean).join(' / ') : ''}>
        {trackMenu && (
          <>
            <SheetItem first label={tx('library.musicSheets.addPlaylist2')} sub={tx('library.musicSheets.existingPlaylistNewOne')} onPress={() => { m.setAddTo(trackMenu.v); m.setTrackMenu(null); }} />
            {trackMenu.onRemove && <SheetItem label={tx('library.musicSheets.removePlaylist')} sub={tx('library.musicSheets.trackItselfIsntDeleted')} onPress={() => { trackMenu.onRemove!(trackMenu.v); m.setTrackMenu(null); }} />}
            <SheetItem label={m.favs.data?.has(trackMenu.v.id) ? tx('library.musicSheets.removeFavorites') : tx('library.musicSheets.addFavorites')} sub={tx('library.musicSheets.filterableTracksTab')} onPress={() => { void m.toggleFav(trackMenu.v); m.setTrackMenu(null); }} />
            {localSave.available() && (localStateOf(m.ls, trackMenu.v.id, node).saved
              ? <SheetItem label={tx('library.musicSheets.deleteOfflineCopy')} sub={tx('library.musicSheets.removesDeviceTrackStays')} onPress={() => {
                void localSave.remove(trackMenu.v.id, node); m.setMsg({ ok: true, text: tx('library.musicSheets.deletedOfflineCopy') }); m.setTrackMenu(null);
              }} />
              : <SheetItem label={tx('library.tab.local')} sub={tx('library.musicSheets.keepDeviceListenOffline')} onPress={() => {
                const v = trackMenu.v;
                localSave.download(api, v.id, node, { ...localSaveMetaOf(v, v.series_name), title: v.album_name || v.eit_title || '' });
                m.setMsg({ ok: true, text: tx('library.musicSheets.startedSavingOffline') }); m.setTrackMenu(null);
              }} />)}
            <SheetItem label={tx('library.musicSheets.viewEditTagJson')} sub={tx('library.musicSheets.editArtistAlbumYear')} onPress={() => { m.setTagId(trackMenu.v.id); m.setTrackMenu(null); }} />
            <SheetItem danger label={tx('library.musicSheets.deleteTrack')} sub={tx('library.musicSheets.deletesFileToo')} onPress={async () => {
              const v = trackMenu.v;
              m.setTrackMenu(null);
              if (!(await confirmAsync(tx('library.musicSheets.delete', { v0: trackTitle(v) }), tx('reservations.list.sheet.delete')))) return;
              try { await api.videoActions.remove(v.id, node); done(tx('library.musicSheets.deleted')); } catch (e) { m.fail(e); }
            }} />
          </>
        )}
      </Sheet>
      {m.tagId != null && <TagJsonSheet videoId={m.tagId} node={node} open onClose={() => m.setTagId(null)} onApplied={m.reload} />}

      {/* フォルダへ移す */}
      <Sheet open={!!moveTarget} onClose={() => m.setMoveTarget(null)} title={moveTarget ? tx('library.musicSheets.wherePut', { v0: moveTarget.name }) : ''}>
        {moveTarget && [{ id: null as number | null, name: tx('library.musicSheets.notFolderTopLevel') }, ...pls.filter((p) => p.kind === 'folder' && p.id !== moveTarget.id)].map((f) => (
          <Pressable key={String(f.id)} onPress={async () => { try { await api.music.updatePlaylist(moveTarget.id, { parent_id: f.id }); m.setMoveTarget(null); m.reload(); } catch (e) { m.fail(e); } }}
            style={[ms.plPick, { borderColor: theme.line, backgroundColor: (moveTarget.parent_id ?? null) === f.id ? theme.surface2 : 'transparent' }]}>
            <T size={12}>{f.id == null ? f.name : `📁 ${f.name}`}</T>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}
