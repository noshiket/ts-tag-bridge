// 予約
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../context';
import { queryKeys } from '../keys';
import { listQueries, type Node } from './shared';

/** 予約の一覧（元の Web 版と同じく 30 秒ごとに取り直す） */
export function useReserves(node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ ...listQueries.reserves(api, node), refetchInterval: 30_000, enabled });
}

/** チューナーの割り当て（このサーバーだけ） */
export function useTunerReserves(node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ ...listQueries.tunerReserves(api, node), enabled });
}

/** 予約1件の詳細 */
export function useReserve(id: number, node?: Node) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.reserve(id, node), queryFn: () => api.reserves.one(id, node) });
}

/** 予約のスキップ・解除・削除。済んだら一覧と詳細を取り直す */
export function useReserveActions(node?: Node) {
  const api = useApi();
  const qc = useQueryClient();
  // 一覧も詳細も 'reserves' の下にある
  const refresh = () => qc.invalidateQueries({ queryKey: ['reserves', node ?? ''] });
  return {
    skip: useMutation({ mutationFn: (id: number) => api.reserves.skip(id, node), onSettled: refresh }),
    unskip: useMutation({ mutationFn: (id: number) => api.reserves.unskip(id, node), onSettled: refresh }),
    syncEpg: useMutation({ mutationFn: (ruleId: number) => api.reserves.syncEpg(ruleId), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: number) => api.reserves.remove(id, node), onSettled: refresh }) };
}
