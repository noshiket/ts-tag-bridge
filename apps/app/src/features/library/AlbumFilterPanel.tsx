import { ALBUM_SORT_DEFAULT_DIR, TEXT_TARGETS, sortArrow, toggleSort, type AlbumFilter, type AlbumSort, type SortDir } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { Check } from '../../ui/inputs/Check';
import { Chip } from '../../ui/inputs/Chip';
import { DateInput } from '../../ui/inputs/DateInput';
import { HistoryInput } from '../../ui/inputs/HistoryInput';
import { ClearButton, FilterLabel, FilterPanel, FilterRow, filterStyles } from '../../ui/inputs/FilterPanel';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { monoFamily } from '../../ui/theme/theme';
import { useT } from '../../ui/i18n/I18n';

/**
 * アルバム一覧の絞り込み（SORT / GENRE / DIR / SEARCH / 放送日）。SEARCH の言葉は、上のチェックで選んだ名前
 * （アルバム名・シリーズ名・カテゴリ名。既定は全部）に当てる。カテゴリは数百あってチップで選べる量ではないので、言葉で探す。
 * localOnly: ローカル保存の一覧では SEARCH だけ（他はアルバム一覧への絞り込みなので）
 */
export function AlbumFilterPanel({ facets, filter, setFilter, sortBy, sortDir, setSort, localOnly }: {
  facets: { genres: string[]; genreCounts: Record<string, number>; dirs: string[]; dirCounts: Record<string, number> };
  filter: AlbumFilter;
  setFilter: (f: Partial<AlbumFilter>) => void;
  sortBy: AlbumSort;
  sortDir: SortDir;
  setSort: (key: AlbumSort, dir: SortDir) => void;
  localOnly?: boolean;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const sortChip = (key: AlbumSort, label: string) => (
    <Chip key={key} size="sm" color={accent.secondary} active={sortBy === key}
      onPress={() => { const r = toggleSort(sortBy, sortDir, key, ALBUM_SORT_DEFAULT_DIR); setSort(r.key, r.dir); }}>
      {label}{sortBy === key ? ` ${sortArrow(sortDir)}` : ''}
    </Chip>
  );
  const input = (active: boolean) => [styles.input, { borderColor: active ? accent.tertiary : theme.line, backgroundColor: theme.surface2, color: theme.ink }];
  return (
    <FilterPanel>
      {!localOnly && (
      <FilterRow label="SORT">
        {sortChip('added', tx('sort.added'))}
        {sortChip('broadcast', tx('sort.broadcast'))}
        {sortChip('name', tx('sort.name'))}
        {sortChip('watched', tx('sort.watched'))}
      </FilterRow>
      )}
      {!localOnly && facets.genres.length > 0 && (
        <FilterRow label="GENRE">
          <Chip size="sm" color={accent.primary} active={!filter.genre} onPress={() => setFilter({ genre: '' })}>{tx('filter.all')}</Chip>
          {facets.genres.map((g) => (
            <Chip key={g} size="sm" color={accent.primary} active={filter.genre === g}
              onPress={() => setFilter({ genre: filter.genre === g ? '' : g })}>{`${g} (${facets.genreCounts[g]})`}</Chip>
          ))}
        </FilterRow>
      )}
      {/* 保存先が1箇所しか無い環境では出さない */}
      {!localOnly && facets.dirs.length > 1 && (
        <FilterRow label="DIR">
          <Chip size="sm" color={accent.quaternary} active={!filter.dir} onPress={() => setFilter({ dir: '' })}>{tx('filter.all')}</Chip>
          {facets.dirs.map((d) => (
            <Chip key={d} size="sm" color={accent.quaternary} active={filter.dir === d}
              onPress={() => setFilter({ dir: filter.dir === d ? '' : d })}>
              {`${d.split('/').filter(Boolean).slice(-2).join('/')} (${facets.dirCounts[d]})`}
            </Chip>
          ))}
        </FilterRow>
      )}
      {!localOnly && (
        <View style={[styles.line, styles.targets]}>
          {TEXT_TARGETS.map(([k, label]) => {
            const on = filter.textIn.includes(k);
            return <Check key={k} on={on} label={label}
              onPress={() => setFilter({ textIn: on ? filter.textIn.filter((x) => x !== k) : [...filter.textIn, k] })} />;
          })}
        </View>
      )}
      <View style={[styles.line, styles.top]}>
        <FilterLabel>SEARCH</FilterLabel>
        <HistoryInput histKey="library_filter" value={filter.text} onChangeText={(text) => setFilter({ text })} placeholder={tx('library.album.filter.search')}
          style={input(!!filter.text)} wrapStyle={styles.grow} />
        {!!filter.text && <ClearButton onPress={() => setFilter({ text: '' })} />}
      </View>
      {!localOnly && (
      <View style={[styles.line, styles.wrap]}>
        <FilterLabel>{tx('library.album.filter.broadcast')}</FilterLabel>
        <DateInput value={filter.dateFrom} onChangeText={(dateFrom) => setFilter({ dateFrom })} style={input(!!filter.dateFrom)} wrapStyle={styles.date} />
        <T size={11} dim>〜</T>
        <DateInput value={filter.dateTo} onChangeText={(dateTo) => setFilter({ dateTo })} style={input(!!filter.dateTo)} wrapStyle={styles.date} />
        {!!(filter.dateFrom || filter.dateTo) && <ClearButton onPress={() => setFilter({ dateFrom: '', dateTo: '' })} />}
      </View>
      )}
    </FilterPanel>
  );
}

const styles = StyleSheet.create({
  line: filterStyles.line,
  wrap: { flexWrap: 'wrap', gap: 6 },
  targets: { flexWrap: 'wrap', gap: 14 },
  grow: { flex: 1 },
  // 履歴の候補（Web では欄の下に浮かせる）が次の行に隠れないよう、この行を手前に
  top: { zIndex: 60 },
  input: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  date: { width: 120 },
});
