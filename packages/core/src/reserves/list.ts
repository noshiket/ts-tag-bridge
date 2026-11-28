// 予約一覧の見せ方（元の Web 版の reservations.jsx と api.jsx の _adaptReserve と同じ決め方）
import type { Reserve } from './types';

export type ReserveStatus = 'scheduled' | 'recording' | 'recorded' | 'encoded' | 'skipped' | 'error';

/**
 * 状態。無効なら skipped。録画中は録画ルールが recording を持つ（アドオンの予約）か、
 * 予約済のうち今が開始〜終了の間（EDCB の予約は実際に録っているかを持たないので時刻で補う）
 */
export function reserveStatus(r: Reserve, nowMs: number): ReserveStatus {
  if (r.rec_enabled === 0) return 'skipped';
  const s = r.rule_state;
  const base: ReserveStatus = s === 'encoded' || s === 'done' ? 'encoded'
    : s === 'recorded' || s === 'recording' || s === 'skipped' || s === 'error' ? s : 'scheduled';
  if (base === 'scheduled' && r.start_time) {
    const start = Date.parse(r.start_time);
    if (nowMs >= start && nowMs < start + r.duration_sec * 1000) return 'recording';
  }
  return base;
}

/** スキップ扱い（無効、または録画ルールがスキップ） */
export const isSkipped = (r: Reserve) => r.rec_enabled === 0 || r.rule_state === 'skipped';

const pad = (n: number) => String(n).padStart(2, '0');
/** 端末の時刻で 'YYYY-MM-DD HH:mm' */
const localStamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 開始・終了（'YYYY-MM-DD HH:mm'）と長さ（分） */
export function reserveTimes(r: Reserve): { start: string; end: string; durationMin: number } {
  if (!r.start_time) return { start: '', end: '', durationMin: 0 };
  const start = Date.parse(r.start_time);
  return { start: localStamp(start), end: localStamp(start + r.duration_sec * 1000), durationMin: Math.round(r.duration_sec / 60) };
}

/** 録画中の進み具合（0〜1）。遅れて始まった・延長した録画もあるので範囲に収める */
export function recordingProgress(r: Reserve, nowMs: number): number {
  if (!r.start_time || !r.duration_sec) return 0;
  return Math.max(0, Math.min(1, (nowMs - Date.parse(r.start_time)) / (r.duration_sec * 1000)));
}

/** 確定値のフォルダ（複数話は ', ' でつなぐ） */
export function reserveFolder(r: Reserve): string {
  const f = r.confirmed?.folder;
  return Array.isArray(f) ? f.filter(Boolean).join(', ') : typeof f === 'string' ? f : '';
}
/** 確定値のフォルダ名の候補（アルバムのサムネを借りるのに使う） */
export function reserveFolderNames(r: Reserve): string[] {
  const f = r.confirmed?.folder;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string' && !!x) : typeof f === 'string' && f ? [f] : [];
}

/** 話数の種類（複数話・単数話・定義なし） */
export function episodeKind(r: Reserve): 'multi' | 'single' | 'none' {
  const ep = r.confirmed?.episode_number;
  if (ep == null || ep === '') return 'none';
  if (Array.isArray(ep)) return ep.length >= 2 ? 'multi' : 'single';
  return 'single';
}

const majorGenre = (r: Reserve) => (r.genre || '').split('>')[0]!.trim();
const day = (r: Reserve) => reserveTimes(r).start.slice(0, 10);

export interface ReserveFilters {
  /** 上の3枚のカード */
  status: 'all' | 'scheduled' | 'skip';
  /** スキップの内訳（dup = このアプリが重複で無効にした / other = EDCB 側・手動） */
  skip: 'all' | 'dup' | 'other';
  station: string;
  date: string;
  folder: 'all' | 'with' | 'without';
  ep: 'all' | 'multi' | 'single' | 'none';
  tuner: string;
  genre: string;
  parserErr: 'all' | 'yes' | 'no';
  text: string;
}

export const DEFAULT_RESERVE_FILTERS: ReserveFilters = {
  status: 'all', skip: 'all', station: '', date: '', folder: 'all', ep: 'all', tuner: '', genre: '', parserErr: 'all', text: '',
};

/** 「絞込」の中で選んでいる数（上のカードとスキップの内訳は数えない） */
export const activeReserveFilterCount = (f: ReserveFilters) =>
  [f.station, f.date, f.folder !== 'all', f.ep !== 'all', f.tuner, f.genre, f.parserErr !== 'all', f.text].filter(Boolean).length;

/** EDCB は割り当てられなかった予約を「チューナー不足」という名前の組にまとめて返す */
export const TUNER_SHORTAGE = 'チューナー不足';

/**
 * 絞り込んで並べる。録画中 → チューナー不足 → ほかの順で、その中は開始の早い順（チューナー不足は録れないので、
 * 先の予約でも上に出して気づけるように）。tunerOf はチューナーの割り当て（他のサーバーを見ている時は渡さない＝絞らない）
 */
export function filterReserves(list: Reserve[], f: ReserveFilters, nowMs: number, tunerOf?: Map<number, string>): Reserve[] {
  const q = f.text.toLowerCase();
  return list.filter((r) => {
    const status = reserveStatus(r, nowMs);
    const skipped = isSkipped(r);
    if (f.status === 'scheduled' && !((status === 'scheduled' || status === 'recording') && !skipped)) return false;
    if (f.status === 'skip' && !skipped) return false;
    if (f.station && r.station_name !== f.station) return false;
    if (f.date && day(r) !== f.date) return false;
    if (f.folder === 'with' && !reserveFolder(r)) return false;
    if (f.folder === 'without' && reserveFolder(r)) return false;
    if (f.ep !== 'all' && episodeKind(r) !== f.ep) return false;
    if (tunerOf && f.tuner && tunerOf.get(r.reserve_id) !== f.tuner) return false;
    if (f.genre && majorGenre(r) !== f.genre) return false;
    if (f.parserErr === 'yes' && !(r.parser_error?.length > 0)) return false;
    if (f.parserErr === 'no' && r.parser_error?.length > 0) return false;
    if (f.skip === 'dup' && r.auto_skip_reason !== 'duplicate') return false;
    if (f.skip === 'other' && !(skipped && r.auto_skip_reason !== 'duplicate')) return false;
    if (q && !(r.title || '').toLowerCase().includes(q) && !(r.station_name || '').toLowerCase().includes(q)) return false;
    return true;
  }).map((r) => ({ r, rank: reserveStatus(r, nowMs) === 'recording' ? 0 : tunerOf?.get(r.reserve_id) === TUNER_SHORTAGE ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || (a.r.start_time || '').localeCompare(b.r.start_time || ''))
    .map((x) => x.r);
}

/** r と放送時間が重なる予約（r 自身は除く。開始の早い順）。終わりと始まりがちょうど接するだけの物は重ならない扱い */
export function overlappingReserves<R extends Reserve>(r: Reserve, list: R[]): R[] {
  if (!r.start_time) return [];
  const s = Date.parse(r.start_time);
  const e = s + (r.duration_sec || 0) * 1000;
  return list.filter((x) => {
    if (x.reserve_id === r.reserve_id || !x.start_time) return false;
    const xs = Date.parse(x.start_time);
    return xs < e && s < xs + (x.duration_sec || 0) * 1000;
  }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
}

const countBy = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

/** 上のカードの数と、「絞込」に並べる選択肢（それぞれの件数つき） */
export function reserveFacets(list: Reserve[], nowMs: number, tuners: string[] = []) {
  const skipped = list.filter(isSkipped);
  const skipDup = skipped.filter((r) => r.auto_skip_reason === 'duplicate').length;
  const withFolder = list.filter((r) => !!reserveFolder(r)).length;
  const errors = list.filter((r) => r.parser_error?.length > 0).length;
  return {
    all: list.length,
    scheduled: list.filter((r) => { const s = reserveStatus(r, nowMs); return (s === 'scheduled' || s === 'recording') && !isSkipped(r); }).length,
    skipDup,
    skipOther: skipped.length - skipDup,
    /** 件数の多い順 */
    stations: byCount(countBy(list.map((r) => r.station_name).filter(Boolean))),
    dates: [...new Set(list.map(day).filter(Boolean))].sort(),
    folder: { with: withFolder, without: list.length - withFolder },
    ep: { multi: list.filter((r) => episodeKind(r) === 'multi').length, single: list.filter((r) => episodeKind(r) === 'single').length, none: list.filter((r) => episodeKind(r) === 'none').length },
    genres: byCount(countBy(list.map(majorGenre).filter(Boolean))),
    tuners: [...new Set(tuners)].sort(),
    parserErr: { yes: errors, no: list.length - errors },
  };
}

/** チューナーの割り当てを予約番号から引けるように */
export const tunerMapOf = (rows: { tuner_name: string; reserve_ids: number[] }[]) =>
  new Map(rows.flatMap((t) => t.reserve_ids.map((id) => [id, t.tuner_name] as const)));
