// 共通の型と、画面のフックと先読みで共有する一覧の取り方
import { recordingsQuery, type RecFilters } from '../../recordings/list';

import { useApi } from '../context';
import { queryKeys } from '../keys';

export type Node = string | null | undefined;

export type Api = ReturnType<typeof useApi>;

/**
 * 一覧の取り方（キーと取る関数）。画面のフックと、サーバーを切り替える前の先読み（アプリの
 * usePrefetchOtherServer）で同じものを使う。キーや取り方がずれると、先読みが画面に使われない
 */
export const listQueries = {
  albums: (api: Api, node: Node) => ({ queryKey: queryKeys.albums(node), queryFn: () => api.library.albums(node) }),
  reserves: (api: Api, node: Node) => ({ queryKey: queryKeys.reserves(node), queryFn: () => api.reserves.list(node) }),
  tunerReserves: (api: Api, node: Node) => ({ queryKey: queryKeys.tunerReserves(node), queryFn: () => api.reserves.tuners(node) }),
  recordings: (api: Api, f: RecFilters, page: number, perPage: number, node: Node) => ({
    queryKey: queryKeys.recordings(node, recordingsQuery(f, page, perPage)),
    queryFn: () => api.recordings.list(f, page, perPage, node) }),
  encodes: (api: Api, node: Node) => ({ queryKey: queryKeys.encodes(node), queryFn: () => api.encodes.list(node) }),
  services: (api: Api, node: Node) => ({ queryKey: ['epg', node ?? '', 'services'], queryFn: () => api.epg.services(node), staleTime: 10 * 60_000 }),
  autoAdd: (api: Api, node: Node) => ({ queryKey: queryKeys.autoAdd(node), queryFn: () => api.autoAdd.list(node) }),
  manuAdd: (api: Api, node: Node) => ({ queryKey: queryKeys.manuAdd(node), queryFn: () => api.autoAdd.manu.list(node) }) };
