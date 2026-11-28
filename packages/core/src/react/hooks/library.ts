// ライブラリ（アルバム・シリーズ・キャプチャ・動画の移動）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Capture } from '../../library/types';

import { useApi } from '../context';
import { queryKeys } from '../keys';
import { listQueries, type Node } from './shared';

export function useAlbums(node?: Node) {
  const api = useApi();
  return useQuery(listQueries.albums(api, node));
}

export function useAlbum(id: number, node?: Node) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.album(id, node), queryFn: () => api.library.album(id, node) });
}

export function useSeries(id: number, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.series(id, node), queryFn: () => api.library.series(id, node), enabled });
}

export function useAlbumCaptures(id: number, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.albumCaptures(id, node), queryFn: () => api.library.albumCaptures(id, node), enabled });
}

/** シリーズの並びを動かし、アルバムを取り直す */
/** シリーズの中で動画を並べ替える（このサーバーのアルバムだけ） */
export function useMoveVideo(albumId: number) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, videoId, direction }: { seriesId: number; videoId: number; direction: 'up' | 'down' }) =>
      api.videoActions.move(seriesId, videoId, direction),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.album(albumId, null) }) });
}

export function useMoveSeries(albumId: number) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, direction }: { seriesId: number; direction: 'up' | 'down' }) =>
      api.library.moveSeries(albumId, seriesId, direction),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.album(albumId, null) }) });
}

/**
 * アルバムのキャプチャの操作（削除・動画サムネ・シリーズサムネ）。済んだら一覧とアルバムを取り直す
 * （シリーズサムネはアルバムのシリーズの絵に出る）
 */
export function useCaptureActions(albumId: number | null | undefined) {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => {
    if (albumId == null) return;
    void qc.invalidateQueries({ queryKey: queryKeys.albumCaptures(albumId, null) });
    void qc.invalidateQueries({ queryKey: queryKeys.album(albumId, null) });
  };
  const remove = useMutation({ mutationFn: (c: Capture) => api.library.deleteCapture(c.path), onSettled: refresh });
  const videoThumb = useMutation({
    mutationFn: (c: Capture) => api.library.videoThumbnailFromCapture(c.video_id!, c.path), onSettled: refresh });
  const seriesThumb = useMutation({
    mutationFn: (c: Capture) => api.library.seriesThumbnailFromCapture(c.series_id!, c.path), onSettled: refresh });
  return { remove, videoThumb, seriesThumb };
}
