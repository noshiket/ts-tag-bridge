import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { FILE_MOVE_TIMEOUT_MS } from './videoActions';
import type { AlbumDetail, AlbumSummary, Capture, LibraryCapture, Series, Video } from './types';

/** node を渡すと、そのサーバーのライブラリを見る（このサーバーが中継する） */
export const libraryApi = (c: ApiClient) => ({
  albums: (node?: string | null) => c.get<AlbumSummary[]>(nodePath(node, '/api/videos/albums')),
  album: (albumId: number, node?: string | null) =>
    c.get<AlbumDetail>(nodePath(node, `/api/videos/albums/${albumId}`)),
  series: (seriesId: number, node?: string | null) =>
    c.get<Series>(nodePath(node, `/api/videos/series/${seriesId}/videos`)),
  albumCaptures: (albumId: number, node?: string | null) =>
    c.get<Capture[]>(nodePath(node, `/api/videos/albums/${albumId}/captures`)),
  /** シリーズの並び（設定順）を1つ前/後ろへ。このサーバーのアルバムだけ */
  moveSeries: (albumId: number, seriesId: number, direction: 'up' | 'down') =>
    c.put<unknown>(`/api/videos/albums/${albumId}/series/${seriesId}/move`, { direction }),
  // キャプチャの操作（このサーバーのものだけ）。サムネに設定はサーバーが { ok, error } を返す
  deleteCapture: (path: string, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/streams/captures/${encodeURIComponent(path)}`)),
  videoThumbnailFromCapture: (videoId: number, path: string) =>
    c.post<{ ok: boolean; error?: string }>(`/api/videos/${videoId}/thumbnail/from-capture`, { file: path }),
  seriesThumbnailFromCapture: (seriesId: number, path: string) =>
    c.post<{ ok: boolean; error?: string }>(`/api/videos/series/${seriesId}/thumbnail/from-capture`, { file: path }),

  // 画像の URL。アプリは読み込みに c.authHeaders() を付ける
  albumThumbnailUrl: (albumId: number, node?: string | null) =>
    c.url(nodePath(node, `/api/videos/albums/${albumId}/thumbnail`)),
  seriesThumbnailUrl: (seriesId: number, node?: string | null) =>
    c.url(nodePath(node, `/api/videos/series/${seriesId}/thumbnail`)),
  seriesThumbnailUrlFor: (s: Series, node?: string | null) =>
    s.thumbnail_path
      ? c.url(nodePath(node, `/api/videos/series/${s.id}/thumbnail`)) + `?v=${encodeURIComponent(s.updated_at ?? '')}`
      : null,
  /** アルバムのフォルダ名を変える（配下の動画をまとめて移す。このサーバーだけ） */
  renameFolder: (albumId: number, folder: string) =>
    c.post<{ moved: number; total: number; failed?: { id: number; error: string }[]; new_album_id?: number }>(`/api/videos/albums/${albumId}/folder`, { folder }, { timeoutMs: FILE_MOVE_TIMEOUT_MS }),
  /** シリーズ名を変える（tag.json と、シリーズ名が入ったファイル名も。このサーバーだけ） */
  renameSeries: (seriesId: number, name: string) =>
    c.post<{ renamed: number; total: number; renamed_files: number; failed?: { id: number; error: string }[]; new_series_id?: number }>(`/api/videos/series/${seriesId}/name`, { name }, { timeoutMs: FILE_MOVE_TIMEOUT_MS }),
  /** アルバムの動画を全部消す（ファイル・DB・空になったフォルダ。元に戻せない） */
  deleteAlbum: (albumId: number) => c.delete<{ deleted: number; album_id: number; removed_dirs?: string[] }>(`/api/videos/albums/${albumId}`),
  /** カテゴリの一覧 */
  categories: (node?: string | null) => c.get<{ id: number; name: string }[]>(nodePath(node, '/api/videos/categories')),
  /** カテゴリの動画（アルバムをまたぐ） */
  category: (categoryId: number, node?: string | null) =>
    c.get<{ id: number; name: string; videos: (Video & { series_name?: string | null; album_name?: string | null })[] }>(nodePath(node, `/api/videos/categories/${categoryId}`)),
  /** ライブラリ全体のキャプチャ（新しい順） */
  allCaptures: (node?: string | null) => c.get<LibraryCapture[]>(nodePath(node, '/api/streams/captures')),
  /** 端末へ保存する画像（撮った時の番組の情報を埋め込んである） */
  captureDownloadUrl: (file: string, node?: string | null) =>
    c.url(nodePath(node, `/api/streams/captures/${encodeURIComponent(file)}/download`)),
  captureUrl: (path: string, node?: string | null) =>
    c.url(nodePath(node, `/api/streams/captures/${encodeURIComponent(path)}`)),
  videoThumbnailUrl: (videoId: number, node?: string | null) =>
    c.url(nodePath(node, `/api/videos/${videoId}/thumbnail`)),
  /** 動画をまとめてカードの形で（続きを見る・ローカル保存の一覧用） */
  videoCards: (ids: number[], node?: string | null) =>
    ids.length ? c.get<(Video & { series_name?: string | null; album_name?: string | null })[]>(nodePath(node, `/api/videos/cards?ids=${ids.join(',')}`)) : Promise.resolve([]),
  /** 非公開のカテゴリで隠している動画（ids のうち） */
  privateHidden: (ids: number[], node?: string | null) =>
    ids.length ? c.get<number[]>(nodePath(node, `/api/videos/private_hidden?ids=${ids.join(',')}`)) : Promise.resolve([]),
  /** 番組（放送）からエンコードした動画を探す。無ければ null */
  resolveVideo: async (p: { onid: number; tsid: number | null; sid: number; eid: number | null; eitStart?: string | null; tot?: string | null }) => {
    const q = new URLSearchParams({ onid: String(p.onid), tsid: String(p.tsid ?? ''), sid: String(p.sid), eid: String(p.eid ?? '') });
    if (p.eitStart) q.set('eit_start_time', p.eitStart);
    if (p.tot) q.set('tot', p.tot);
    const d = await c.get<{ video_id: number | null } | null>(`/api/videos/resolve?${q}`);
    return d?.video_id ?? null;
  },
  /** 全部の動画を1列に（ライブラリのビデオ表示）。絞り込みは日付・言葉・フォルダ */
  videoList: (o: { page: number; perPage: number; sort: string; dir: string; from?: string; to?: string; q?: string; dirRoot?: string }, node?: string | null) => {
    const p = new URLSearchParams({ page: String(o.page), per_page: String(o.perPage), sort: o.sort, dir: o.dir });
    if (o.from) p.set('from', o.from);
    if (o.to) p.set('to', o.to);
    if (o.q) p.set('q', o.q);
    if (o.dirRoot) p.set('dir_root', o.dirRoot);
    return c.get<{ items: (Video & { series_name?: string | null; album_name?: string | null })[]; total: number }>(nodePath(node, `/api/videos/list?${p}`));
  },
  /** コメントの勢いの順（その期間） */
  momentum: (period: 'week' | 'month' | 'year', page: number, perPage: number, node?: string | null) =>
    c.get<{ items: (Video & { series_name?: string | null; album_name?: string | null })[]; total: number; page: number; per_page: number }>(
      nodePath(node, `/api/videos/momentum?period=${period}&page=${page}&per_page=${perPage}`)),
});
