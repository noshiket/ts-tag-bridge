// 自動予約の試しの検索の結果（EDCB の番組と配信の番組をそろえた1件）と、その予約の印
import { isSkipped } from '../reserves/list';
import type { Reserve } from '../reserves/types';
import type { EpgEvent } from '../epg/guide';

/** 試しの検索の1件（EDCB の番組か、配信の番組） */
export interface PreviewItem {
  /** 配信の番組（EDCB では予約できないので押せない） */
  addon?: boolean;
  /** 同じ番組名の2回目以降（配信は1回だけ予約する） */
  dup?: boolean;
  title: string; station: string;
  start: number; end: number; durationMin: number;
  /** EDCB の番組ならその番組 */
  event?: EpgEvent;
}
export const previewFromEvent = (e: EpgEvent): PreviewItem => {
  const start = Date.parse(e.start_time);
  return { title: e.title, station: e.station_name ?? '', start, end: start + e.duration_sec * 1000, durationMin: Math.round(e.duration_sec / 60), event: e };
};
/** 録画アドオンの auto_preview の1件（時刻は 'YYYY-MM-DD HH:MM:SS' の端末時刻） */
export function previewFromAddon(p: { title: string; ch_name: string; start_time: string; end_time: string; duration_sec?: number; dup?: boolean }): PreviewItem {
  const iso = (t: string) => (t || '').replace(' ', 'T');
  return { addon: true, dup: !!p.dup, title: p.title, station: p.ch_name, start: Date.parse(iso(p.start_time)), end: Date.parse(iso(p.end_time)), durationMin: Math.round((p.duration_sec || 0) / 60) };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 一覧の時刻 'MM-DD HH:mm · N分'（番組検索と同じ） */
export function previewTimeLabel(p: PreviewItem): string {
  const d = new Date(p.start);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${p.durationMin}分`;
}

const minute = (ms: number) => Math.floor(ms / 60_000);
/** その番組の予約（題名と開始の分が同じもの。元と同じ） */
export const previewReserve = (reserves: Reserve[], p: PreviewItem) =>
  reserves.find((r) => r.title === p.title && r.start_time != null && minute(Date.parse(r.start_time)) === minute(p.start));
export const previewMark = (r: Reserve | undefined) => (r ? (isSkipped(r) ? 'SKIP' : 'REC') : null);
