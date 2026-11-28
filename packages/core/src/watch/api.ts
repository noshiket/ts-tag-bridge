import type { ApiClient } from '../http/client';
import { hasTot, posToTot, totToPos, type TimingMeta } from './position';

/** 視聴履歴の1件（元の Web 版の WatchStore と同じ形。サーバーは fileKey ごとに新しい方を残す） */
export interface WatchEntry {
  fileKey: string;
  lastType: 'video' | 'recording' | string;
  lastId: string;
  onid: number | null;
  tsid: number | null;
  sid: number | null;
  eid: number | null;
  eitStart: string | null;
  title: string;
  episodeNum: string | null;
  episodeName: string | null;
  /** 0〜1 */
  progress: number;
  /** 続きの位置。放送時刻で持てる動画は resumeTot、持てない動画は pos(秒) */
  resumeTot: string | null;
  pos: number | null;
  updatedAt: string;
  playCount?: number;
}

export interface WatchMeta extends TimingMeta {
  onid?: number | null;
  tsid?: number | null;
  sid?: number | null;
  eid?: number | null;
  start_time?: string | null;
  title?: string | null;
}

export const videoFileKey = (id: number | string) => `video:${id}`;

/** 続きの位置(秒)。無ければ null */
export function resumePosition(meta: WatchMeta, e: WatchEntry | null | undefined): number | null {
  if (!e) return null;
  if (e.resumeTot != null && hasTot(meta)) {
    const t = Date.parse(e.resumeTot);
    return Number.isNaN(t) ? null : totToPos(meta, t);
  }
  return typeof e.pos === 'number' ? e.pos : null;
}

/** 今の位置を保存する形にする */
export function watchEntryFor(meta: WatchMeta, video: { id: number | string; title: string; episodeNum?: string | null; episodeName?: string | null; type?: 'video' | 'recording' },
  pos: number, duration: number, prev?: WatchEntry | null): WatchEntry {
  const type = video.type ?? 'video';
  const tot = hasTot(meta) ? posToTot(meta, pos) : null;
  return {
    ...(prev ?? {}),
    onid: meta.onid ?? null, tsid: meta.tsid ?? null, sid: meta.sid ?? null, eid: meta.eid ?? null,
    eitStart: meta.start_time ?? null,
    title: video.title || meta.title || '',
    episodeNum: video.episodeNum ?? null, episodeName: video.episodeName ?? null,
    lastType: type, lastId: String(video.id), fileKey: `${type}:${video.id}`,
    progress: duration ? Math.min(1, pos / duration) : 0,
    updatedAt: new Date().toISOString(),
    resumeTot: tot != null ? new Date(tot).toISOString() : null,
    pos: tot != null ? null : pos,
  };
}

/** 一覧に1件を入れる（同じ fileKey は置き換え、新しいものは頭へ）。保存した時に手元の一覧を直す */
export function mergeWatchEntry(list: WatchEntry[], e: WatchEntry): WatchEntry[] {
  const rest = list.filter((x) => x.fileKey !== e.fileKey);
  return [e, ...rest];
}

/** 動画ごとの見た進み具合（0〜1）。カードの赤い線に使う */
export function watchProgressByVideo(list: WatchEntry[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of list) if (e.lastType === 'video' && e.progress) m.set(Number(e.lastId), e.progress);
  return m;
}

export const watchApi = (c: ApiClient) => ({
  /** 自分の視聴履歴の全部（起動時に一度だけ読む。元の Web 版の同期と同じ） */
  list: () => c.get<WatchEntry[]>('/api/users/me/watch-history'),
  entry: (fileKey: string) =>
    c.get<WatchEntry | null>(`/api/users/me/watch-history/entry?file_key=${encodeURIComponent(fileKey)}`),
  put: (entries: WatchEntry[]) => c.put<{ ok: boolean }>('/api/users/me/watch-history', { entries }),
  /** 動画（音楽を除く）の履歴。続きを見るの一覧 */
  videos: () => c.get<WatchEntry[]>('/api/users/me/watch-history?kind=video'),
  remove: (fileKey: string) => c.delete<unknown>(`/api/users/me/watch-history/${encodeURIComponent(fileKey)}`),
});

/** 履歴の鍵（古い履歴は fileKey を持たない） */
export const watchKey = (e: Pick<WatchEntry, 'fileKey' | 'lastType' | 'lastId'>) => e.fileKey || `${e.lastType}:${e.lastId}`;

/** 続きを見るの並び: 同じ鍵は新しい方だけ、新しい順 */
export function continueList(list: WatchEntry[]): WatchEntry[] {
  const by = new Map<string, WatchEntry>();
  for (const e of list) {
    const k = watchKey(e);
    const ex = by.get(k);
    if (!ex || (e.updatedAt || '') > (ex.updatedAt || '')) by.set(k, e);
  }
  return [...by.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 動画の履歴でカードを出せるもの（他のサーバーの 'node:id' は数でないので除く） */
export const isVideoEntry = (e: WatchEntry) => e.lastType === 'video' && /^\d+$/.test(String(e.lastId));
