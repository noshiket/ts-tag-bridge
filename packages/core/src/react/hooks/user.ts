// 自分・好み・マイリスト・連携先のサーバー
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { prefsPatchBody, type Prefs } from '../../prefs/api';

import { useApi } from '../context';
import { queryKeys } from '../keys';

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.auth.me(), retry: false });
}

export function usePrefs(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.prefs, queryFn: () => api.prefs.get(), enabled });
}

/** 好みを書き換える。画面はすぐ変え、サーバーの応答で上書きする */
export function usePatchPrefs() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    // 今の好みが手元に無ければ先に取る（無いまま一部だけ送ると、他の好みが消える）
    mutationFn: async (body: Partial<Prefs>) =>
      api.prefs.patch(prefsPatchBody(qc.getQueryData<Prefs>(queryKeys.prefs) ?? (await api.prefs.get()), body)),
    onMutate: (body) => {
      const prev = qc.getQueryData<Prefs>(queryKeys.prefs);
      if (prev) qc.setQueryData<Prefs>(queryKeys.prefs, { ...prev, ...body, tweaks: { ...prev.tweaks, ...body.tweaks } });
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(queryKeys.prefs, ctx.prev),
    onSuccess: (p) => qc.setQueryData(queryKeys.prefs, p) });
}

export function useMylist() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.mylist, queryFn: () => api.mylist.ids() });
}

export function useToggleMylist() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, on }: { albumId: number; on: boolean }) => api.mylist.set(albumId, on),
    onMutate: ({ albumId, on }) => {
      const prev = qc.getQueryData<number[]>(queryKeys.mylist) ?? [];
      // 追加は先頭（追加が新しい順）
      qc.setQueryData<number[]>(queryKeys.mylist, on ? [albumId, ...prev.filter((x) => x !== albumId)] : prev.filter((x) => x !== albumId));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx && qc.setQueryData(queryKeys.mylist, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.mylist }) });
}

export function useNodes() {
  const api = useApi();
  // 構成はめったに変わらないが、見てよいサーバー（利用者ごとの権限）は管理者が変えることがある。
  // 外された時にすぐ自サーバーへ戻れるよう、1分ごとに取り直す（軽い問い合わせ）
  return useQuery({ queryKey: queryKeys.nodes, queryFn: () => api.nodes.list(), staleTime: 60_000, refetchInterval: 60_000 });
}
