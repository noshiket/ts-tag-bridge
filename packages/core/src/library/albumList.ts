// ライブラリのアルバム一覧の絞り込み・並び替え（元の encode.jsx LibraryScreen と同じ規則）
import type { AlbumSummary } from './types';

export type AlbumSort = 'added' | 'broadcast' | 'name' | 'watched';
export type SortDir = 'asc' | 'desc';

/** 言葉を当てる名前 */
export type TextTarget = 'album' | 'series' | 'category';
export const TEXT_TARGETS: [TextTarget, string][] = [['album', 'アルバム名'], ['series', 'シリーズ名'], ['category', 'カテゴリ名']];
const ALL_TARGETS: TextTarget[] = TEXT_TARGETS.map(([k]) => k);

export interface AlbumFilter {
  genre: string;
  dir: string;
  text: string;
  /** 言葉をどの名前に当てるか（複数。既定は全部） */
  textIn: TextTarget[];
  /** 'YYYY-MM-DD'。空なら無し */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_ALBUM_FILTER: AlbumFilter = { genre: '', dir: '', text: '', textIn: ALL_TARGETS, dateFrom: '', dateTo: '' };

/** 並び替えの既定の向き。日付系は新しい順、名前は五十音順 */
export const ALBUM_SORT_DEFAULT_DIR: Record<AlbumSort, SortDir> = { added: 'desc', broadcast: 'desc', name: 'asc', watched: 'desc' };

/** 同じ並び替えをもう一度押したら向きを反転、別のものを押したらその既定の向き */
export function toggleSort<K extends string>(cur: K, dir: SortDir, next: K, defaults: Record<K, SortDir>): { key: K; dir: SortDir } {
  return cur === next ? { key: next, dir: dir === 'asc' ? 'desc' : 'asc' } : { key: next, dir: defaults[next] ?? 'asc' };
}

export const sortArrow = (dir: SortDir) => (dir === 'asc' ? '▲' : '▼');

/**
 * eit_genre はカンマ区切りで複数持つことがある（"アニメ・特撮 > 国内アニメ, 映画 > アニメ"）。
 * 大ジャンル（'>' の前）だけを重複なしで返す
 */
export function majorGenres(genre: string | null | undefined): string[] {
  return [...new Set(String(genre ?? '').split(',').map((g) => g.split('>')[0]!.trim()).filter(Boolean))];
}

function countBy(albums: AlbumSummary[], keys: (a: AlbumSummary) => string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of albums) for (const k of keys(a)) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** 絞り込みの候補と件数。ジャンル・カテゴリは件数の多い順、保存先は名前順 */
export function albumFacets(albums: AlbumSummary[]) {
  const genreCounts = countBy(albums, (a) => majorGenres(a.genre));
  const dirCounts = countBy(albums, (a) => a.dirs ?? []);
  const byCount = (c: Record<string, number>) => Object.keys(c).sort((x, y) => c[y]! - c[x]!);
  return {
    genres: byCount(genreCounts), genreCounts,
    dirs: Object.keys(dirCounts).sort(), dirCounts,
  };
}

/** 選んでいる絞り込みの数（ボタンの数字）。期間は1つと数える */
export function activeFilterCount(f: AlbumFilter): number {
  return [f.genre, f.dir, f.text].filter(Boolean).length + (f.dateFrom || f.dateTo ? 1 : 0);
}

export function filterAndSortAlbums(albums: AlbumSummary[], f: AlbumFilter, sort: AlbumSort, dir: SortDir): AlbumSummary[] {
  const text = f.text.toLowerCase();
  // 何も選んでいない時も全部に当てる（当てる先が無いと何も出ないため）
  const targets = f.textIn?.length ? f.textIn : ALL_TARGETS;
  const names = (a: AlbumSummary): string[] => targets.flatMap((t) =>
    t === 'album' ? [a.name ?? ''] : t === 'series' ? a.series_names ?? [] : a.categories ?? []);
  const shown = albums.filter((a) => {
    if (f.genre && !majorGenres(a.genre).includes(f.genre)) return false;
    if (f.dir && !(a.dirs ?? []).includes(f.dir)) return false;
    if (text && !names(a).some((n) => n.toLowerCase().includes(text))) return false;
    // 放送日の期間: アルバム内の [最古, 最新] が [from, to] と重なれば出す
    if (f.dateFrom && !(String(a.latest_broadcast_at ?? '') >= f.dateFrom)) return false;
    if (f.dateTo && !(String(a.earliest_broadcast_at ?? '') <= f.dateTo + 'T99')) return false;
    return true;
  });
  return shown.sort((a, b) => {
    // 分類エラーは並び順によらず先頭へ（直さないと迷子になる）
    const am = (a.folder_mismatch ?? []).length > 0;
    const bm = (b.folder_mismatch ?? []).length > 0;
    if (am !== bm) return am ? -1 : 1;
    if (sort === 'watched') {
      // 見ていないアルバムは向きによらず末尾
      const aw = a.latest_watch_at;
      const bw = b.latest_watch_at;
      if (!aw && !bw) return 0;
      if (!aw) return 1;
      if (!bw) return -1;
      const r = String(aw).localeCompare(String(bw));
      return dir === 'desc' ? -r : r;
    }
    let r: number;
    if (sort === 'name') r = (a.name ?? '').localeCompare(b.name ?? '', 'ja');
    else if (sort === 'broadcast') r = String(a.latest_broadcast_at ?? '').localeCompare(String(b.latest_broadcast_at ?? ''));
    else r = String(a.latest_video_at ?? '').localeCompare(String(b.latest_video_at ?? ''));
    return dir === 'desc' ? -r : r;
  });
}

/** ページに分ける。page は範囲外なら端に寄せる */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(Math.max(0, page), totalPages - 1);
  return { page: cur, totalPages, items: items.slice(cur * pageSize, (cur + 1) * pageSize) };
}

/** 一覧の「最終 11/7」（端末の時刻で月/日） */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** ビデオ表示の並び（アルバムの並びから。見た順は放送日順で代える。元と同じ） */
export const videoListSort = (s: AlbumSort) => (s === 'name' ? 'name' : s === 'added' ? 'added' : 'broadcast');
