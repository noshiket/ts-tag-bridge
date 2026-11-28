import { MUSIC_SORTS, type MusicAlbum, type Playlist, type Track } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useMusicQueue } from '../../../lib/playback/musicQueue';
import { localItems, localSave, shallowEq, useLocalSaveSelect } from '../../../lib/localSave/store';
import { savedState } from '../../../lib/state/savedState';
import { useViewNode } from '../../../lib/state/viewNode';
import { useT } from '../../../ui/i18n/I18n';

const EMPTY_STATES = {};

export type MTab = 'recent' | 'playlists' | 'artists' | 'albums' | 'tracks' | 'local';
export type Drill = { kind: 'artist' | 'album' | 'playlist' | 'folder'; id: number; name: string; sub?: string; ids?: number[]; parent?: Drill | null };

/** 開いているタブ・掘り下げ・並べ方（再生画面へ移って戻っても残す。元は URL に持っていた） */
const useMusicState = savedState({ tab: 'recent' as MTab, drill: null as Drill | null, sort: {} as Record<string, string> });

/**
 * ミュージックの状態・読み込み・操作: タブの一覧、掘り下げの中身、お気に入り、プレイリスト、ローカル保存した曲、
 * 並びを積んでの再生・シャッフル、プレイリストの並べ替えと外す、知らせ（msg）と開いているシート
 */
export function useMusicLibrary() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { viewNode: node } = useViewNode();
  const queue = useMusicQueue();
  const [s, set] = useMusicState();
  const { tab, drill } = s;
  const curSort = (t: string) => s.sort[t] || MUSIC_SORTS[t]?.[0]?.[0] || '';
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [addTo, setAddTo] = useState<Track | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ v: Track; onRemove?: (v: Track) => void } | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<Playlist | null>(null);
  const [newName, setNewName] = useState('');
  const key = (...k: unknown[]) => ['library', node ?? '', 'music', ...k];
  const fail = (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : tx('common.failed2') });
  useEffect(() => { setMsg(null); }, [tab]);

  // この端末に保存した曲（保存の一覧から、曲の分だけ。元と同じくサーバーのカードで出す）。保存の進み具合では描き直さない
  const ls = useLocalSaveSelect((st) => ({ ready: st.ready, index: st.index, states: EMPTY_STATES }), shallowEq);
  const localIds = localItems(ls, node).map((it) => it.id);
  const localTracks = useQuery({
    queryKey: key('local', localIds.join(',')), enabled: tab === 'local' && ls.ready,
    queryFn: async () => (localIds.length ? ((await api.library.videoCards(localIds, node)) as Track[]).filter((v) => v.media_kind === 'audio') : []),
  });
  const favs = useQuery({ queryKey: ['musicFavorites'], queryFn: async () => new Set(await api.music.favorites()) });
  const overview = useQuery({ queryKey: key('overview'), queryFn: () => api.music.overview(24, node), enabled: tab === 'recent' && !drill });
  const artists = useQuery({ queryKey: key('artists', curSort('artists')), queryFn: () => api.music.artists(curSort('artists'), node), enabled: tab === 'artists' || drill?.kind === 'artist' });
  const albums = useQuery({ queryKey: key('albums', curSort('albums')), queryFn: () => api.music.albums(curSort('albums'), node), enabled: tab === 'albums' || !!drill });
  const tracks = useQuery({
    queryKey: key('tracks', curSort('tracks')), enabled: tab === 'tracks' && !drill,
    queryFn: () => api.music.tracks(curSort('tracks') === 'favorite' ? 'title' : curSort('tracks'), curSort('tracks') === 'favorite', node),
  });
  const playlists = useQuery({ queryKey: ['musicPlaylists'], queryFn: () => api.music.playlists() });
  // 掘り下げ: アーティストはアルバム（series）を並べ、曲はシャッフル・続けて再生のために持つ。
  // アルバムはアーティスト違いで割れていれば束ねた series を全部混ぜる。フォルダは曲を持たない
  const drillQ = useQuery({
    queryKey: key('drill', drill?.kind, drill?.id), enabled: !!drill && drill.kind !== 'folder',
    queryFn: async (): Promise<{ tracks: Track[]; albums?: (MusicAlbum & { year_at: string | null })[] }> => {
      const d = drill!;
      if (d.kind === 'artist') {
        const a = await api.library.album(d.id, node);
        return {
          albums: a.series.map((x) => ({
            series_id: x.id, name: x.name, artist: d.name, track_count: x.videos.length, album_id: d.id, updated_at: x.updated_at ?? null,
            year_at: x.videos.map((v) => v.eit_start_time).filter((t): t is string => !!t).sort()[0] ?? null,
          })),
          tracks: a.series.flatMap((x) => x.videos.map((v) => ({ ...v, series_name: x.name, album_name: d.name }))),
        };
      }
      if (d.kind === 'album') {
        const lists = await Promise.all((d.ids?.length ? d.ids : [d.id]).map((id) => api.library.series(id, node).catch(() => null)));
        return {
          tracks: lists.flatMap((x) => x?.videos ?? [])
            // アーティストは曲そのものの値（束ねたアルバムは客演で曲ごとに違う）
            .map((v) => ({ ...v, series_name: d.name, album_name: v.artist || d.sub }))
            .sort((a, b) => (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0)),
        };
      }
      return { tracks: (await api.music.playlist(d.id)).tracks ?? [] };
    },
  });

  // 再生（並びを積んで再生画面へ。元はフッターのミニプレイヤーで鳴らす）
  const open = (id: number) => router.push({ pathname: '/watch/[id]', params: { id: String(id), from: 'start', ...(localSave.isSaved(id, node) ? { local: '1' } : {}), ...(node ? { node } : {}) } });
  const touchPlaylist = () => { if (drill?.kind === 'playlist') api.music.touchPlayed(drill.id).catch(() => {}); };
  const playList = (list: Track[], startId?: number) => {
    if (!list.length) return;
    queue.set(list.map((v) => v.id), node);
    touchPlaylist();
    open(startId ?? list[0]!.id);
  };
  const shuffle = (list: Track[]) => {
    if (!list.length) return;
    const ids = queue.shuffle(list.map((v) => v.id), node);
    touchPlaylist();
    open(ids[0]!);
  };
  const toggleFav = async (v: Track) => {
    const on = !favs.data?.has(v.id);
    const flip = (add: boolean) => qc.setQueryData<Set<number>>(['musicFavorites'], (p) => { const n = new Set(p); if (add) n.add(v.id); else n.delete(v.id); return n; });
    flip(on);
    try { await api.music.setFavorite(v.id, on); } catch { flip(!on); }
  };
  const reload = () => { void qc.invalidateQueries({ queryKey: ['library', node ?? '', 'music'] }); void qc.invalidateQueries({ queryKey: ['musicPlaylists'] }); };
  const moveInPlaylist = async (v: Track, dir: 'up' | 'down') => {
    if (!drill) return;
    try { await api.music.moveItem(drill.id, v.id, dir); void drillQ.refetch(); } catch (e) { fail(e); }
  };
  const removeFromPlaylist = async (v: Track) => {
    if (!drill) return;
    try { await api.music.removeItem(drill.id, v.id); reload(); } catch (e) { fail(e); }
  };
  const deletePlaylist = async (p: Playlist) => { try { await api.music.deletePlaylist(p.id); reload(); } catch (e) { fail(e); } };
  const createPlaylist = async (kind: 'playlist' | 'folder') => {
    const name = newName.trim();
    if (!name) return;
    try { await api.music.createPlaylist(name, kind); setNewName(''); reload(); } catch (e) { fail(e); }
  };

  return {
    api, node, s, set, tab, drill, setDrill: (d: Drill | null) => set({ drill: d }), curSort, queue,
    msg, setMsg, fail, addTo, setAddTo, trackMenu, setTrackMenu, tagId, setTagId, moveTarget, setMoveTarget, newName, setNewName,
    ls, localTracks, favs, overview, artists, albums, tracks, playlists, pls: playlists.data ?? [], drillQ,
    playList, shuffle, toggleFav, reload, moveInPlaylist, removeFromPlaylist, deletePlaylist, createPlaylist,
  };
}

export type MusicLibrary = ReturnType<typeof useMusicLibrary>;
