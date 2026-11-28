import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { EpgEvent, Service } from './guide';

/** 番組表のキャッシュの版（元と同じ。上げると端末のキャッシュを捨てる） */
const V = '1.0';

export const epgApi = (c: ApiClient) => ({
  services: (node?: string | null) => c.get<Service[]>(nodePath(node, `/api/services?v=${V}`)),
  /** その局（と同じ TS の局）の番組。番組の詳細は落としてある（全体の 73%） */
  events: async (onid: number, tsid: number, sid: number, node?: string | null) => {
    const d = await c.get<EpgEvent[] | { events?: EpgEvent[] }>(nodePath(node, `/api/epg?service=${onid}-${tsid}-${sid}&no_ext=1&v=${V}`));
    return Array.isArray(d) ? d : d.events ?? [];
  },
  /** 番組1件（詳細つき。シートを開いた時に取る） */
  event: (onid: number, tsid: number, sid: number, eventId: number, node?: string | null) =>
    c.get<EpgEvent>(nodePath(node, `/api/epg/event?service=${onid}-${tsid}-${sid}&event_id=${eventId}&v=${V}`)),
  /** ロゴを持っている局（ロゴは局で決まるので、いつもこのサーバーのもの） */
  logos: () => c.get<{ onid: number; sid: number }[]>('/api/logo/list'),
  /** 実況の勢い（コメ/分。'onid-sid' → 数） */
  forces: (node?: string | null) => c.get<Record<string, number>>(node ? `/api/nodes/${node}/jikkyo/forces` : '/api/jikkyo/forces'),
  /** 番組から予約する。recEnabled 0 はスキップとして入れる */
  reserve: (e: Pick<EpgEvent, 'onid' | 'tsid' | 'sid' | 'event_id'>, recEnabled: 0 | 1, node?: string | null, extra?: { rec_mode: number; priority: number }) =>
    c.post<unknown>(nodePath(node, '/api/reserves'), { event_id: `${e.onid}-${e.tsid}-${e.sid}-${e.event_id}`, ...(recEnabled ? {} : { rec_enabled: 0 }), ...extra }),
  /** 番組検索（searchParams で作った問い合わせ） */
  search: async (query: string, node?: string | null) => {
    const d = await c.get<EpgEvent[]>(nodePath(node, `/api/search?${query}`));
    return Array.isArray(d) ? d : [];
  },
});
