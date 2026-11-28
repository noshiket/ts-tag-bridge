// アルバムの中の絞り込み・並び替え（元の encode.jsx LibraryScreen のアルバム詳細と同じ規則）
import type { SortDir } from './albumList';
import type { AlbumDetail, Series, Video } from './types';
import { hasAnyCaption, hasSecondaryAudioByEit } from './video';

export type SeriesSort = 'manual' | 'added' | 'name';
export type VideoSort = 'episode' | 'manual';
export type YesNo = 'all' | 'yes' | 'no';

export interface DetailFilter {
  station: string;
  caption: YesNo;
  audio: YesNo;
}

export const EMPTY_DETAIL_FILTER: DetailFilter = { station: '', caption: 'all', audio: 'all' };
export const SERIES_SORT_DEFAULT_DIR: Record<SeriesSort, SortDir> = { manual: 'asc', added: 'asc', name: 'asc' };
export const VIDEO_SORT_DEFAULT_DIR: Record<VideoSort, SortDir> = { episode: 'asc', manual: 'asc' };

export const activeDetailFilterCount = (f: DetailFilter) =>
  [f.station, f.caption !== 'all', f.audio !== 'all'].filter(Boolean).length;

/** 局の候補と件数（多い順） */
export function stationFacets(detail: AlbumDetail | undefined) {
  const counts: Record<string, number> = {};
  for (const s of detail?.series ?? []) for (const v of s.videos) {
    if (v.eit_station_name) counts[v.eit_station_name] = (counts[v.eit_station_name] ?? 0) + 1;
  }
  return { stations: Object.keys(counts).sort((a, b) => counts[b]! - counts[a]!), counts };
}

const yesNo = (want: YesNo, has: boolean) => want === 'all' || has === (want === 'yes');

/**
 * 絞り込みを動画ごとにかけ、0件になったシリーズは出さない。並び替えはシリーズ・動画それぞれ
 */
export function filterAndSortSeries(
  detail: AlbumDetail | undefined, f: DetailFilter,
  seriesSort: SeriesSort, seriesDir: SortDir, videoSort: VideoSort, videoDir: SortDir,
): Series[] {
  if (!detail) return [];
  const flip = (dir: SortDir, r: number) => (dir === 'desc' ? -r : r);
  const seriesCmp = (a: Series, b: Series) => {
    let r: number;
    if (seriesSort === 'name') r = (a.name || '').localeCompare(b.name || '', 'ja');
    else if (seriesSort === 'added') r = (a.created_at || '').localeCompare(b.created_at || '');
    else r = (a.sort_order || 0) - (b.sort_order || 0) || (a.name || '').localeCompare(b.name || '', 'ja');
    return flip(seriesDir, r);
  };
  const videoCmp = (a: Video, b: Video) => {
    let r: number;
    if (videoSort === 'manual') {
      r = (a.sort_order || 0) - (b.sort_order || 0) || (a.created_at || '').localeCompare(b.created_at || '');
    } else {
      const na = parseFloat(a.episode_number ?? '');
      const nb = parseFloat(b.episode_number ?? '');
      const va = Number.isFinite(na) ? na : Infinity;
      const vb = Number.isFinite(nb) ? nb : Infinity;
      r = (va === vb ? 0 : va - vb) || (a.created_at || '').localeCompare(b.created_at || '');
    }
    return flip(videoDir, r);
  };
  return detail.series
    .map((s) => ({
      ...s,
      videos: s.videos.filter((v) =>
        (!f.station || v.eit_station_name === f.station)
        && yesNo(f.caption, hasAnyCaption(v))
        && yesNo(f.audio, hasSecondaryAudioByEit(v)),
      ).sort(videoCmp),
    }))
    .filter((s) => s.videos.length > 0)
    .sort(seriesCmp);
}

/**
 * 話数・話数名が同じ動画をまとめる（同じ話を別の局で録ったもの）。まとめた中はコメントの多い順。
 * 話数も話数名も無い動画はまとめない
 */
export function groupDuplicateVideos(videos: Video[]): Video[][] {
  const groups: Video[][] = [];
  const byKey = new Map<string, Video[]>();
  for (const v of videos) {
    const key = v.episode_name || v.episode_number ? `${v.episode_number ?? ''}|${v.episode_name ?? ''}` : `__uniq_${v.id}`;
    const g = byKey.get(key);
    if (g) g.push(v);
    else { const n = [v]; byKey.set(key, n); groups.push(n); }
  }
  for (const g of groups) if (g.length > 1) g.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
  return groups;
}
