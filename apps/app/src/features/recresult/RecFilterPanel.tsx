import {
  REC_STATE_LABELS, REC_STATUS_LABELS, sortRecStates, stationsByCount, type RecFilters, type RecordingSummary,
} from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { Chip } from '../../ui/inputs/Chip';
import { DateInput } from '../../ui/inputs/DateInput';
import { HistoryInput } from '../../ui/inputs/HistoryInput';
import { ClearButton, FilterLabel, FilterPanel, FilterRow, filterStyles } from '../../ui/inputs/FilterPanel';
import { oklch } from '../../ui/theme/oklch';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { RED, recStateColor, recStatusColor } from './colors';
import { trLabel, useT } from '../../ui/i18n/I18n';

/**
 * 録画結果の絞り込み（CH / FOLDER / EP / REC / STATE / ERR / FILE / DROP / SEARCH / DATE）。元の recresult.jsx と同じ並び。
 * 件数はサーバーが今の条件で数えたもの
 */
export function RecFilterPanel({ summary: m, f, set }: {
  summary: RecordingSummary;
  f: RecFilters;
  set: (patch: Partial<RecFilters>) => void;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const stations = stationsByCount(m.stations);
  const statuses = Object.keys(m.rec_statuses ?? {}).map(Number).sort((a, b) => a - b);
  const states = sortRecStates(Object.keys(m.states ?? {}));
  const input = (on: boolean) => [styles.input, { borderColor: on ? accent.tertiary : theme.line, backgroundColor: theme.surface, color: theme.ink }];
  return (
    <FilterPanel>
      {stations.length > 0 && (
        <FilterRow label="CH" labelWidth={44}>
          <Chip size="sm" color={accent.secondary} active={!f.station} onPress={() => set({ station: '' })}>{tx('filter.allStations')}</Chip>
          {stations.map(([s, n]) => (
            <Chip key={s} size="sm" color={accent.secondary} active={f.station === s} onPress={() => set({ station: f.station === s ? '' : s })}>{`${s} (${n})`}</Chip>
          ))}
        </FilterRow>
      )}
      {Object.keys(m.genres ?? {}).length > 0 && (
        <FilterRow label="GENRE" labelWidth={44}>
          <Chip size="sm" color={accent.primary} active={!f.genre} onPress={() => set({ genre: '' })}>{tx('filter.all')}</Chip>
          {Object.entries(m.genres ?? {}).sort((a, b) => b[1] - a[1]).map(([g, n]) => (
            <Chip key={g} size="sm" color={accent.primary} active={f.genre === g} onPress={() => set({ genre: f.genre === g ? '' : g })}>{`${g} (${n})`}</Chip>
          ))}
        </FilterRow>
      )}
      <FilterRow label="FOLDER" labelWidth={44}>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'all'} onPress={() => set({ folder: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'with'} onPress={() => set({ folder: 'with' })}>{tx('filter.with', { n: m.folder_with ?? 0 })}</Chip>
        <Chip size="sm" color={accent.quaternary} active={f.folder === 'without'} onPress={() => set({ folder: 'without' })}>{tx('filter.without', { n: m.folder_without ?? 0 })}</Chip>
      </FilterRow>
      <FilterRow label="EP" labelWidth={44}>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'all'} onPress={() => set({ ep: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'multi'} onPress={() => set({ ep: 'multi' })}>{tx('filter.epMulti', { n: m.ep_multi ?? 0 })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'single'} onPress={() => set({ ep: 'single' })}>{tx('filter.epSingle', { n: m.ep_single ?? 0 })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.ep === 'none'} onPress={() => set({ ep: 'none' })}>{tx('filter.epNone', { n: m.ep_none ?? 0 })}</Chip>
      </FilterRow>
      {statuses.length > 0 && (
        <FilterRow label="REC" labelWidth={44}>
          <Chip size="sm" color={accent.primary} active={f.recStatus === 'all'} onPress={() => set({ recStatus: 'all' })}>{tx('filter.all')}</Chip>
          {statuses.map((s) => (
            <Chip key={s} size="sm" color={recStatusColor(s, theme)} active={f.recStatus === s} onPress={() => set({ recStatus: f.recStatus === s ? 'all' : s })}>
              {`${trLabel(tx, 'state.recStatus', s, REC_STATUS_LABELS)} (${m.rec_statuses?.[String(s)] ?? 0})`}
            </Chip>
          ))}
        </FilterRow>
      )}
      {states.length > 0 && (
        <FilterRow label="STATE" labelWidth={44}>
          <Chip size="sm" color={accent.primary} active={f.state === 'all'} onPress={() => set({ state: 'all' })}>{tx('filter.all')}</Chip>
          {states.map((s) => (
            <Chip key={s} size="sm" color={recStateColor(s, theme)} active={f.state === s} onPress={() => set({ state: f.state === s ? 'all' : s })}>
              {`${trLabel(tx, 'state.rec', s, REC_STATE_LABELS)} (${m.states?.[s] ?? 0})`}
            </Chip>
          ))}
        </FilterRow>
      )}
      <FilterRow label="ERR" labelWidth={44}>
        <Chip size="sm" color={accent.primary} active={f.parserErr === 'all'} onPress={() => set({ parserErr: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={RED} active={f.parserErr === 'yes'} onPress={() => set({ parserErr: f.parserErr === 'yes' ? 'all' : 'yes' })}>{tx('filter.errYes', { n: m.parser_err_yes ?? 0 })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.parserErr === 'no'} onPress={() => set({ parserErr: f.parserErr === 'no' ? 'all' : 'no' })}>{tx('filter.errNo', { n: m.parser_err_no ?? 0 })}</Chip>
      </FilterRow>
      <FilterRow label="FILE" labelWidth={44}>
        <Chip size="sm" color={accent.quaternary} active={f.fileExist === 'all'} onPress={() => set({ fileExist: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.fileExist === 'yes'} onPress={() => set({ fileExist: f.fileExist === 'yes' ? 'all' : 'yes' })}>{tx('filter.fileYes', { n: m.file_exist_yes ?? 0 })}</Chip>
        <Chip size="sm" color={RED} active={f.fileExist === 'no'} onPress={() => set({ fileExist: f.fileExist === 'no' ? 'all' : 'no' })}>{tx('filter.fileNo', { n: m.file_exist_no ?? 0 })}</Chip>
        {(m.file_exist_null ?? 0) > 0 && (
          <Chip size="sm" color={oklch(0.55, 0.12, 260)} active={f.fileExist === 'unscanned'}
            onPress={() => set({ fileExist: f.fileExist === 'unscanned' ? 'all' : 'unscanned' })}>{tx('filter.unscanned', { n: m.file_exist_null ?? 0 })}</Chip>
        )}
      </FilterRow>
      <FilterRow label="DROP" labelWidth={44}>
        <Chip size="sm" color={accent.quaternary} active={f.drop === 'all'} onPress={() => set({ drop: 'all' })}>{tx('filter.all')}</Chip>
        <Chip size="sm" color={oklch(0.58, 0.25, 25)} active={f.drop === 'yes'} onPress={() => set({ drop: f.drop === 'yes' ? 'all' : 'yes' })}>{tx('filter.with', { n: m.drop_yes ?? 0 })}</Chip>
        <Chip size="sm" color={accent.tertiary} active={f.drop === 'no'} onPress={() => set({ drop: f.drop === 'no' ? 'all' : 'no' })}>{tx('filter.without', { n: m.drop_no ?? 0 })}</Chip>
      </FilterRow>
      <View style={[filterStyles.line, styles.top]}>
        <FilterLabel width={44}>SEARCH</FilterLabel>
        <HistoryInput histKey="recresult_filter" value={f.text} onChangeText={(text) => set({ text })} placeholder={tx('reservations.list.filter.search')}
          style={[input(!!f.text), styles.noFlex]} wrapStyle={styles.grow} />
        {!!f.text && <ClearButton onPress={() => set({ text: '' })} />}
      </View>
      <View style={filterStyles.line}>
        <FilterLabel width={44}>DATE</FilterLabel>
        <DateInput value={f.date} onChangeText={(date) => set({ date })} style={[input(!!f.date), styles.noFlex]} wrapStyle={styles.grow} />
        {!!f.date && <ClearButton onPress={() => set({ date: '' })} />}
      </View>
    </FilterPanel>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  // 履歴の候補（Web では欄の下に浮かせる）が次の行に隠れないよう、この行を手前に
  top: { zIndex: 60 },
  // 履歴つきの欄は枠の中で縦に並ぶので、欄そのものは伸ばさない（伸ばすのは枠）
  noFlex: { flex: 0 },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
});
