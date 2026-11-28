// 再生する物の情報・実況・字幕・印（チャプター・ドロップ）
import { useQuery } from '@tanstack/react-query';

import { targetKey, type StreamRef } from '../../stream/target';

import { useApi } from '../context';
import { queryKeys } from '../keys';
import { type Node } from './shared';

export function useStreamMeta(target: StreamRef, node?: Node) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.streamMeta(targetKey(target), node), queryFn: () => api.stream.meta(target, node) });
}

export function useComments(target: StreamRef, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.comments(targetKey(target), node), queryFn: () => api.comments.payload(target, node), enabled, staleTime: 5 * 60_000 });
}

export function useCaptions(target: StreamRef, track: string, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.captions(targetKey(target), track, node), queryFn: () => api.captions.data(target, track, node), enabled, staleTime: 5 * 60_000 });
}

export function useStreamMarks(target: StreamRef, node?: Node) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.marks(targetKey(target), node), queryFn: () => api.marks.get(target, node), staleTime: 5 * 60_000 });
}
