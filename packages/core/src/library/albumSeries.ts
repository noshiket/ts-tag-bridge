// アルバムを開いた時に、どのシリーズを選んでおくか
import type { WatchEntry } from '../watch/api';
import type { Series } from './types';

/** 名前の合うシリーズ（詳細の ↗ から開いた時: 詳細のタイトルがシリーズ名） */
export function seriesIdByName(series: Series[], name: string | null | undefined): number | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  return series.find((s) => String(s.name ?? '').trim() === n)?.id ?? null;
}

const day = (s: string | null | undefined) => String(s ?? '').slice(0, 10);

/**
 * このアルバムで最後に見た動画のシリーズ。視聴履歴にはサーバーの区別が無いので、放送の識別子（sid・eid と
 * 放送日）で照らし合わせる（動画が別のサーバーへ送られても変わらない）。同じサーバーなら動画の番号でも合わせる
 */
export function lastWatchedSeriesId(series: Series[], history: WatchEntry[] | undefined, sameServer: boolean): number | null {
  if (!history?.length) return null;
  const byId = new Map<number, number>();
  const byBroadcast: { sid: number; eid: number; day: string; series: number }[] = [];
  for (const s of series) {
    for (const v of s.videos) {
      byId.set(v.id, s.id);
      if (v.sid != null && v.eid != null) byBroadcast.push({ sid: v.sid, eid: v.eid, day: day(v.eit_start_time), series: s.id });
    }
  }
  const newest = [...history].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (const e of newest) {
    if (sameServer && e.lastType === 'video') {
      const hit = byId.get(Number(e.lastId));
      if (hit != null) return hit;
    }
    if (e.sid != null && e.eid != null) {
      const d = day(e.eitStart);
      const hit = byBroadcast.find((b) => b.sid === e.sid && b.eid === e.eid && (!d || !b.day || d === b.day));
      if (hit) return hit.series;
    }
  }
  return null;
}
