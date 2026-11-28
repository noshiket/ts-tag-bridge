// 録画・エンコード・解析のプレビュー
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { choosePreview, mockParse, type Pattern } from '../../patterns/parse';
import { type RecFilters } from '../../recordings/list';
import type { Recording } from '../../recordings/types';

import { useApi } from '../context';
import { queryKeys } from '../keys';
import { listQueries, type Node } from './shared';

/**
 * 録画結果の1ページ（絞り込み・数えるのはサーバー）。条件を変えている間は前のページを出したままにし、
 * 30 秒ごとに取り直す（元と同じ）
 */
export function useRecordings(f: RecFilters, page: number, perPage: number, node?: Node) {
  const api = useApi();
  return useQuery({
    ...listQueries.recordings(api, f, page, perPage, node),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000 });
}

/** 録画結果を消す。済んだら一覧を取り直す */
export function useRemoveRecording(node?: Node) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ r, keepEdcb }: { r: Recording; keepEdcb: boolean }) => api.recordings.remove(r, keepEdcb, node),
    onSettled: () => qc.invalidateQueries({ queryKey: ['recordings', node ?? ''] }) });
}

/** エンコードのキューと履歴（実行中があれば 15 秒、なければ 30 秒ごとに取り直す。元と同じ） */
export function useEncodes(node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({
    ...listQueries.encodes(api, node), enabled,
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'running') ? 15_000 : 30_000) });
}

/** エンコード全体の停止・再開 */
export function useEncodePause(node?: Node) {
  const api = useApi();
  const qc = useQueryClient();
  // hidden_running・hidden_queued（権限で見られない番組のエンコード中・待ちの件数）も載るので、一覧と同じ間隔で取り直す
  const q = useQuery({ queryKey: queryKeys.encodePause(node), queryFn: () => api.encodes.pause(node), refetchInterval: 30_000 });
  const set = useMutation({
    mutationFn: (paused: boolean) => api.encodes.setPause(paused, node),
    onSuccess: (r) => qc.setQueryData(queryKeys.encodePause(node), (old: object | undefined) => ({ ...old, ...r })) });
  return { paused: q.data?.paused, hiddenRunning: q.data?.hidden_running ?? 0, hiddenQueued: q.data?.hidden_queued ?? 0, set };
}

/** 解析プレビューに渡す番組（予約・録画の詳細から） */
export interface ParseInput {
  title: string;
  sid: number | null;
  onid: number | null;
  tsid: number | null;
  service_name: string;
  start_time: string | null;
  description: string;
  extended_info: string;
}

/**
 * 解析プレビュー（元の ParsePreview の読み込み）: 題名をそろえ、その局のパターンを読み、
 * サーバーで実際に採用される結果と簡易版から出すものを決める。
 * 番組詳細は後から届くことがあるので、説明・詳細が変わったら見直す（本文に掛かる条件があるため）
 */
export function useParsePreview(input: ParseInput | null, node?: Node) {
  const api = useApi();
  // 予約・録画のサーバー（node）のパターンで解析する。このサーバーで解析すると、サーバーごとにパターンが
  // 違う時に、そのサーバーの実際の解析（再解析）と食い違う
  const key = input ? JSON.stringify([node ?? '', input.title, input.sid, input.description, input.extended_info]) : '';
  return useQuery({
    queryKey: queryKeys.parsePreview(key),
    enabled: !!input,
    queryFn: async () => {
      const r = input!;
      if (!r.title) return { preview: { status: 'nomatch' } as const, patterns: [] as Pattern[], normTitle: '' };
      const [texts, patterns] = await Promise.all([
        api.patterns.normalize({ title: r.title }, node).catch(() => null),
        r.sid ? api.patterns.list(r.sid, node).catch(() => null) : Promise.resolve(null),
      ]);
      const normTitle = texts?.title || r.title;
      const server = r.sid && patterns ? await api.patterns.preview({ ...r }, patterns, node).catch(() => null) : null;
      const list = patterns ?? [];
      return { preview: choosePreview(normTitle, server, mockParse(normTitle, list)), patterns: list, normTitle };
    } });
}

/** 録画1件の詳細（このアプリの録画の番号で） */
export function useRecording(dbRecId: number, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.recording(dbRecId, node), queryFn: () => api.recordings.one(dbRecId, node), enabled });
}

/** TS の映像・音声の中身（解像度・コーデック） */
export function useRecordingProbe(dbRecId: number, node?: Node, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.recordingProbe(dbRecId, node), queryFn: () => api.recordings.probe(dbRecId, node), retry: false, enabled });
}
