import { activeReserveFilterCount, type ReserveFilters, type reserveFacets } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '../../ui/inputs/Chip';
import { ClearButton, FilterLabel, FilterPanel, FilterRow, filterStyles } from '../../ui/inputs/FilterPanel';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 予約一覧の絞り込み（CH / DATE / FOLDER / EP / GENRE / TUNER / SEARCH / ERR）。元の reservations.jsx と同じ並び */
export function ReserveFilterPanel({ facets, f, set, showTuner }: {
  facets: ReturnType<typeof reserveFacets>;
  f: ReserveFilters;
  set: (patch: Partial<ReserveFilters>) => void;
  /** チューナーの割り当てが取れた時だけ出す */
  showTuner: boolean;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const toggle = <K extends keyof ReserveFilters>(k: K, v: ReserveFilters[K], off: ReserveFilters[K]) =>
    set({ [k]: f[k] === v ? off : v } as Partial<ReserveFilters>);
  return (
    <FilterPanel>
      {facets.stations.length > 0 && (
        <FilterRow label="CH" labelWidth={40}>
          <Chip size="sm" color={accent.secondary} active={!f.station} onPress={() => set({ station: '' })}>{tx('filter.allStations')}</Chip>
          {facets.stations.map(([s, n]) => (
            <Chip key={s} size="sm" color={accent.secondary} active={f.station === s} onPress={() => toggle('station', s, '')}>{`${s} (${n})`}</Chip>
          ))}
        </FilterRow>
      )}
      {facets.dates.length > 0 && (
        <FilterRow label="DATE" labelWidth={40}>
          <Chip size="sm" color={accent.tertiary} active={!f.date} onPress={() => set({ date: '' })}>{tx('filter.allDates')}</Chip>
          {facets.dates.map((d) => (
            <Chip key={d} size="sm" color={accent.tertiary} active={f.date === d} onPress={() => toggle('date', d, '')}>{d.slice(5)}</Chip>
          ))}
        </FilterRow>
      )}
      <FilterRow label="FOLDER" labelWidth={40}>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'all'} onPress={() => set({ folder: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'with'} onPress={() => set({ folder: 'with' })}>{tx('filter.with', { n: facets.folder.with })}</Chip>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'without'} onPress={() => set({ folder: 'without' })}>{tx('filter.without', { n: facets.folder.without })}</Chip>
      </FilterRow>
      <FilterRow label="EP" labelWidth={40}>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'all'} onPress={() => set({ ep: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'multi'} onPress={() => set({ ep: 'multi' })}>{tx('filter.epMulti', { n: facets.ep.multi })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'single'} onPress={() => set({ ep: 'single' })}>{tx('filter.epSingle', { n: facets.ep.single })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'none'} onPress={() => set({ ep: 'none' })}>{tx('filter.epNone', { n: facets.ep.none })}</Chip>
      </FilterRow>
      {facets.genres.length > 0 && (
        <FilterRow label="GENRE" labelWidth={40}>
          <Chip size="sm" color={accent.primary} active={!f.genre} onPress={() => set({ genre: '' })}>{tx('filter.all')}</Chip>
          {facets.genres.map(([g, n]) => (
            <Chip key={g} size="sm" color={accent.primary} active={f.genre === g} onPress={() => toggle('genre', g, '')}>{`${g} (${n})`}</Chip>
          ))}
        </FilterRow>
      )}
      {showTuner && facets.tuners.length > 0 && (
        <FilterRow label="TUNER" labelWidth={40}>
          <Chip size="sm" color={accent.primary} active={!f.tuner} onPress={() => set({ tuner: '' })}>{tx('filter.all')}</Chip>
          {facets.tuners.map((t) => (
            <Chip key={t} size="sm" color={accent.primary} active={f.tuner === t} onPress={() => toggle('tuner', t, '')}>
              {t.replace(/^BonDriver_/, '').replace(/\.so$/, '')}
            </Chip>
          ))}
        </FilterRow>
      )}
      <View style={filterStyles.line}>
        <FilterLabel width={40}>SEARCH</FilterLabel>
        <TextInput value={f.text} onChangeText={(text) => set({ text })} placeholder={tx('reservations.list.filter.search')}
          placeholderTextColor={theme.mute} autoCorrect={false} autoCapitalize="none"
          style={[styles.input, { borderColor: f.text ? accent.tertiary : theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
        {!!f.text && <ClearButton onPress={() => set({ text: '' })} />}
      </View>
      <FilterRow label="ERR" labelWidth={40}>
        <Chip size="sm" color={accent.primary} active={f.parserErr === 'all'} onPress={() => set({ parserErr: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color="#E62B34" active={f.parserErr === 'yes'} onPress={() => toggle('parserErr', 'yes', 'all')}>{tx('filter.errYes', { n: facets.parserErr.yes })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.parserErr === 'no'} onPress={() => toggle('parserErr', 'no', 'all')}>{tx('filter.errNo', { n: facets.parserErr.no })}</Chip>
      </FilterRow>
      {activeReserveFilterCount(f) > 0 && (
        <Pressable onPress={() => set({ station: '', date: '', folder: 'all', ep: 'all', tuner: '', genre: '', parserErr: 'all', text: '' })}
          style={[styles.reset, { borderColor: theme.line }]}>
          <T mono size={9} w={700} dim>{tx('filter.reset')}</T>
        </Pressable>
      )}
    </FilterPanel>
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  reset: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1 },
});
