// 視聴の位置（履歴）
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { mergeWatchEntry, watchProgressByVideo, type WatchEntry } from '../../watch/api';

import { useApi } from '../context';
import { queryKeys } from '../keys';

// 同じ一覧からの集計は1回だけ（カードごとに千件ほどの履歴を集計し直さない）
const progressCache = new WeakMap<WatchEntry[], Map<number, number>>();

const progressSelect = (list: WatchEntry[]) => {
  let m = progressCache.get(list);
  if (!m) { m = watchProgressByVideo(list); progressCache.set(list, m); }
  return m;
};

/**
 * 動画ごとの見た進み具合（カードの赤い線）。視聴履歴の全部を一度だけ読み、
 * 再生中の保存は手元の一覧へ直接入れる（useSaveWatch）ので、読み直さない
 */
export function useWatchProgress() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.watchHistory, queryFn: () => api.watch.list(), staleTime: Infinity, select: progressSelect });
}

/** 視聴履歴の全部（アルバムを開いた時に、最後に見たシリーズを選ぶのに使う）。進み具合と同じ一覧を使い回す */
export function useWatchHistory() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.watchHistory, queryFn: () => api.watch.list(), staleTime: Infinity }).data;
}

/**
 * その動画の見た進み具合だけ（カードの赤い線）。値が変わった時だけ描き直す。
 * useWatchProgress() は再生中の保存（10秒ごと）のたびに新しい表を返すので、一覧のカードが全部描き直され、
 * 再生画面の裏に一覧を開いたまま小窓で見ていると画面の処理が詰まり、小窓の操作が効かず落ちた（2026-11-16）
 */
export function useWatchProgressOf(videoId: number) {
  const api = useApi();
  const select = useCallback((list: WatchEntry[]) => progressSelect(list).get(videoId) ?? 0, [videoId]);
  return useQuery({ queryKey: queryKeys.watchHistory, queryFn: () => api.watch.list(), staleTime: Infinity, select }).data ?? 0;
}

/** 視聴履歴を保存し、手元の一覧と、その動画の続きの位置も直す */
export function useSaveWatch() {
  const api = useApi();
  const qc = useQueryClient();
  return (e: WatchEntry) => {
    qc.setQueryData<WatchEntry[]>(queryKeys.watchHistory, (old) => (old ? mergeWatchEntry(old, e) : old));
    return api.watch.put([e]);
  };
}

/** この動画の視聴履歴（続きの位置）。無ければ null */
export function useWatchEntry(fileKey: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.watchEntry(fileKey),
    queryFn: () => api.watch.entry(fileKey).catch(() => null),
    // 再生中に古い位置で取り直すと、続きの位置が戻ってしまう
    staleTime: Infinity });
}
