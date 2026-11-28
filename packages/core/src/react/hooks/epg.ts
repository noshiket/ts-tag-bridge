// 番組表・ロゴ・実況の勢い・自動予約のルール
import { useQueries, useQuery } from '@tanstack/react-query';

import type { ChannelGroup, EpgEvent } from '../../epg/guide';

import { useApi } from '../context';
import { listQueries, type Node } from './shared';

/** 番組表の局（見ているサーバーの） */
export function useServices(node?: Node) {
  const api = useApi();
  return useQuery(listQueries.services(api, node));
}

/**
 * 番組表の番組（列ごと）。1列（同じ局のサブチャンネルをまとめたもの）につき1回取り、サブチャンネルにも同じものを配る
 * （サーバーはサブチャンネルの番組を代表の局にまとめて返す）。
 * 元の Web 版は同じ TS の局をまとめて1回にしていたが、CS は同じ TS に別の局が入っていて
 * （通販チャンネルと映画チャンネルなど）、2局目以降に1局目の番組が出ていたので、局の列ごとに取る
 */
export function useEpgEvents(groups: ChannelGroup[], node?: Node) {
  const api = useApi();
  const qs = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['epg', node ?? '', 'events', g.id],
      queryFn: () => api.epg.events(g.onid, g.tsid, g.sid, node),
      staleTime: 5 * 60_000 })) });
  const byId = new Map<string, EpgEvent[]>();
  groups.forEach((g, i) => { for (const ch of g.subChannels) byId.set(ch.id, qs[i]?.data ?? []); });
  return { byId, loading: qs.some((q) => q.isLoading) };
}

/** ロゴを持っている局（'onid-sid' の集まり） */
export function useLogoSet() {
  const api = useApi();
  return useQuery({ queryKey: ['epg', 'logos'], queryFn: async () => new Set((await api.epg.logos()).map((l) => `${l.onid}-${l.sid}`)), staleTime: 30 * 60_000 });
}

/** 実況の勢い（コメ/分。30 秒ごと。元と同じ） */
export function useJikkyoForces(node?: Node) {
  const api = useApi();
  return useQuery({ queryKey: ['epg', node ?? '', 'forces'], queryFn: () => api.epg.forces(node), refetchInterval: 30_000 });
}

/** EPG キーワード自動予約のルール（配信のルールも含む） */
export function useAutoAdd(node?: Node) {
  const api = useApi();
  return useQuery(listQueries.autoAdd(api, node));
}

/** プログラム予約のルール */
export function useManuAdd(node?: Node) {
  const api = useApi();
  return useQuery(listQueries.manuAdd(api, node));
}
