import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { Reserve, ReserveDetail, TunerReserves } from './types';

export const reservesApi = (c: ApiClient) => ({
  list: (node?: string | null) => c.get<Reserve[]>(nodePath(node, '/api/reserves/augmented')),
  /** チューナーの割り当て（このサーバーだけ） */
  /** 予約ごとのチューナーの割り当て（EDCB）。node: 他のサーバーの予約を見ている時 */
  tuners: (node?: string | null) => c.get<TunerReserves[]>(nodePath(node, '/api/tuner_reserves')),
  one: (reserveId: number, node?: string | null) => c.get<ReserveDetail>(nodePath(node, `/api/reserves/augmented/${reserveId}`)),
  /** 無効にする（予約は残る。EDCB の change_reserve で recEnabled=0） */
  skip: (reserveId: number, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/reserves/${reserveId}`), { rec_enabled: 0 }),
  /** スキップを解く */
  unskip: (reserveId: number, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/reserves/${reserveId}`), { rec_enabled: 1 }),
  /** EPG から番組の説明・ジャンルなどを取り直す（このサーバーの録画ルールだけ） */
  syncEpg: (ruleId: number) => c.post<unknown>(`/api/rules/${ruleId}/sync_epg`, {}),
  /** 消す（EDCB の del_reserve） */
  remove: (reserveId: number, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/reserves/${reserveId}`)),
  /** 手動予約（このサーバーだけ。manualReserveBody で作った中身） */
  addManual: (body: Record<string, unknown>) => c.post<unknown>('/api/reserves', body),
});
