// ミュージック（元の encode.jsx の MusicList と helpers.jsx の MusicQueue）。
// 音楽は album = アーティスト / series = アルバム / video = 曲（episode_number = トラック番号、episode_name = 曲名）で入っている
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { Video } from '../library/types';

export type Track = Video & { album_name?: string | null; series_name?: string | null; play_count?: number; album_id?: number; series_id?: number };
export interface Artist { id: number; name: string; video_count: number; latest_video_updated_at?: string | null }
export interface MusicAlbum { series_id: number; series_ids?: number[]; album_id: number; name: string; artist?: string; track_count: number; year_at?: string | null; updated_at?: string | null; added_at?: string }
export interface Playlist { id: number; name: string; kind: 'playlist' | 'folder' | string; parent_id: number | null; item_count: number; created_at?: string; updated_at?: string; last_played_at?: string | null }

export type Repeat = 'off' | 'all' | 'one';
export const REPEAT_KEY = 'tstag_music_repeat';
export const parseRepeat = (v: string | null): Repeat => (v === 'all' || v === 'one' ? v : 'off');
/** オフ → 全体 → 1曲 の順に */
export const nextRepeat = (r: Repeat): Repeat => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off');

/** 並びの中の今の曲から1つ動かした先。端なら null（全体の繰り返しなら回り込む） */
export function adjacentInQueue(ids: number[], id: number, direction: number, repeat: Repeat): number | null {
  const i = ids.indexOf(id);
  if (i === -1) return null;
  const j = i + (direction < 0 ? -1 : 1);
  if (j >= 0 && j < ids.length) return ids[j]!;
  if (repeat === 'all' && ids.length) return j < 0 ? ids[ids.length - 1]! : ids[0]!;
  return null;
}

/** 混ぜる（first を渡すとそれを1曲目にする） */
export function shuffleIds(ids: number[], first: number | null = null, rand: () => number = Math.random): number[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  if (first != null) {
    const k = a.indexOf(first);
    if (k > 0) { a.splice(k, 1); a.unshift(first); }
  }
  return a;
}

/** プレイリストの並べ替え（更新日・タイトル・追加・最後に再生・タイプ） */
export function sortPlaylists(list: Playlist[], sort: string): Playlist[] {
  const a = [...list];
  const s = (x?: string | null) => x || '';
  if (sort === 'title') a.sort((x, y) => s(x.name).localeCompare(s(y.name)));
  else if (sort === 'added') a.sort((x, y) => s(y.created_at).localeCompare(s(x.created_at)));
  else if (sort === 'played') a.sort((x, y) => s(y.last_played_at).localeCompare(s(x.last_played_at)));
  else if (sort === 'kind') a.sort((x, y) => s(x.kind).localeCompare(s(y.kind)) || s(x.name).localeCompare(s(y.name)));
  else a.sort((x, y) => s(y.updated_at).localeCompare(s(x.updated_at)));
  return a;
}

/** タブごとの並べ方（先頭が既定） */
export const MUSIC_SORTS: Record<string, [string, string][]> = {
  playlists: [['updated', '更新日'], ['title', 'タイトル'], ['added', '追加'], ['played', '最後に再生'], ['kind', 'タイプ']],
  artists: [['name', '名前'], ['added', '追加']],
  albums: [['title', 'タイトル'], ['added', '追加'], ['artist', 'アーティスト'], ['year', '年']],
  tracks: [['title', 'タイトル'], ['added', '追加'], ['artist', 'アーティスト'], ['favorite', 'お気に入り']],
};

export const trackTitle = (v: Track) => v.episode_name || v.eit_title || `vdb:${v.id}`;

export const musicApi = (c: ApiClient) => ({
  overview: (limit: number, node?: string | null) => c.get<{ recent?: Track[]; top?: Track[] }>(nodePath(node, `/api/music/overview?limit=${limit}`)),
  artists: (sort: string, node?: string | null) => c.get<Artist[]>(nodePath(node, `/api/music/artists?sort=${sort || 'name'}`)),
  albums: (sort: string, node?: string | null) => c.get<MusicAlbum[]>(nodePath(node, `/api/music/albums?sort=${sort || 'title'}`)),
  tracks: (sort: string, favorite: boolean, node?: string | null) =>
    c.get<Track[]>(nodePath(node, `/api/music/tracks?sort=${sort || 'title'}${favorite ? '&favorite=1' : ''}`)),
  /** お気に入り（自分の。このサーバー） */
  favorites: () => c.get<number[]>('/api/music/favorites'),
  setFavorite: (videoId: number, on: boolean) => (on ? c.put<unknown>(`/api/music/favorites/${videoId}`, {}) : c.delete<unknown>(`/api/music/favorites/${videoId}`)),
  playlists: () => c.get<Playlist[]>('/api/music/playlists'),
  playlist: (id: number) => c.get<{ tracks?: Track[] }>(`/api/music/playlists/${id}`),
  createPlaylist: (name: string, kind: 'playlist' | 'folder') => c.post<Playlist>('/api/music/playlists', { name, kind }),
  updatePlaylist: (id: number, body: { parent_id?: number | null; name?: string }) => c.patch<unknown>(`/api/music/playlists/${id}`, body),
  deletePlaylist: (id: number) => c.delete<unknown>(`/api/music/playlists/${id}`),
  addItems: (id: number, videoIds: number[]) => c.post<unknown>(`/api/music/playlists/${id}/items`, { video_ids: videoIds }),
  removeItem: (id: number, videoId: number) => c.delete<unknown>(`/api/music/playlists/${id}/items/${videoId}`),
  moveItem: (id: number, videoId: number, direction: 'up' | 'down') => c.post<unknown>(`/api/music/playlists/${id}/items/${videoId}/move`, { direction }),
  /** 最後に再生した時を記録する（「最後に再生」の並べ替えに使う） */
  touchPlayed: (id: number) => c.post<unknown>(`/api/music/playlists/${id}/played`, {}),
  /** アルバム（series）の曲を全部消す */
  deleteSeries: (seriesId: number) => c.delete<{ deleted: number }>(`/api/videos/series/${seriesId}`),
  /** ジャケット（原本を正方形に。無ければサムネ） */
  coverUrl: (videoId: number, node?: string | null) => c.url(nodePath(node, `/api/videos/${videoId}/cover?fallback=1`)),
  artistCoverUrl: (albumId: number, ts: string | null | undefined, node?: string | null) =>
    c.url(nodePath(node, `/api/videos/albums/${albumId}/cover?v=${encodeURIComponent(ts || '')}`)),
  albumCoverUrl: (seriesId: number, ts: string | null | undefined, node?: string | null) =>
    c.url(nodePath(node, `/api/videos/series/${seriesId}/cover?v=${encodeURIComponent(ts || '')}`)),
});
