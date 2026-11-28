import {
  SERIES_SORT_DEFAULT_DIR, VIDEO_SORT_DEFAULT_DIR, sortArrow, toggleSort,
  type DetailFilter, type SeriesSort, type SortDir, type VideoSort, type YesNo,
} from '@tstag/core';

import { Chip } from '../../ui/inputs/Chip';
import { FilterPanel, FilterRow } from '../../ui/inputs/FilterPanel';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** アルバムの中の絞り込み（SERIES / VIDEO の並び、局・字幕・副音声）。元の Web 版と同じ並び */
export function DetailFilterPanel({ stations, stationCounts, filter, setFilter, seriesSort, seriesDir, setSeriesSort, videoSort, videoDir, setVideoSort }: {
  stations: string[];
  stationCounts: Record<string, number>;
  filter: DetailFilter;
  setFilter: (f: Partial<DetailFilter>) => void;
  seriesSort: SeriesSort;
  seriesDir: SortDir;
  setSeriesSort: (k: SeriesSort, d: SortDir) => void;
  videoSort: VideoSort;
  videoDir: SortDir;
  setVideoSort: (k: VideoSort, d: SortDir) => void;
}) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  const W = 70;
  const sChip = (k: SeriesSort, l: string) => (
    <Chip key={k} size="sm" color={accent.secondary} active={seriesSort === k}
      onPress={() => { const r = toggleSort(seriesSort, seriesDir, k, SERIES_SORT_DEFAULT_DIR); setSeriesSort(r.key, r.dir); }}>
      {l}{seriesSort === k ? ` ${sortArrow(seriesDir)}` : ''}
    </Chip>
  );
  const vChip = (k: VideoSort, l: string) => (
    <Chip key={k} size="sm" color={accent.tertiary} active={videoSort === k}
      onPress={() => { const r = toggleSort(videoSort, videoDir, k, VIDEO_SORT_DEFAULT_DIR); setVideoSort(r.key, r.dir); }}>
      {l}{videoSort === k ? ` ${sortArrow(videoDir)}` : ''}
    </Chip>
  );
  const yn = (key: 'caption' | 'audio') => (['all', 'yes', 'no'] as YesNo[]).map((v) => (
    <Chip key={v} size="sm" color={accent.quaternary} active={filter[key] === v} onPress={() => setFilter({ [key]: v })}>
      {v === 'all' ? tx('filter.all') : v === 'yes' ? tx('common.yes') : tx('recresult.qc.none')}
    </Chip>
  ));
  return (
    <FilterPanel>
      <FilterRow label="SERIES" labelWidth={W}>{sChip('manual', tx('library.detailFilterPanel.setOrder'))}{sChip('added', tx('library.detailFilterPanel.added'))}{sChip('name', tx('sort.name'))}</FilterRow>
      <FilterRow label="VIDEO" labelWidth={W}>{vChip('episode', tx('library.detailFilterPanel.episode'))}{vChip('manual', tx('library.detailFilterPanel.setOrder'))}</FilterRow>
      {stations.length > 0 && (
        <FilterRow label={tx('library.detailFilterPanel.station')} labelWidth={W}>
          <Chip size="sm" color={accent.primary} active={!filter.station} onPress={() => setFilter({ station: '' })}>{tx('filter.allStations')}</Chip>
          {stations.map((st) => (
            <Chip key={st} size="sm" color={accent.primary} active={filter.station === st}
              onPress={() => setFilter({ station: filter.station === st ? '' : st })}>{`${st} (${stationCounts[st]})`}</Chip>
          ))}
        </FilterRow>
      )}
      <FilterRow label={tx('common.captions')} labelWidth={W}>{yn('caption')}</FilterRow>
      <FilterRow label={tx('library.local.saveSap')} labelWidth={W}>{yn('audio')}</FilterRow>
    </FilterPanel>
  );
}
