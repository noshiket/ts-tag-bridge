import { guideBand, stepScale } from '@tstag/core';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BANDS, type EpgData } from './useEpgData';
import { Plus, Search } from '../../../ui/parts/Icons';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { localizeFmt, useT } from '../../../ui/i18n/I18n';

const VIEWS = [['grid', 'Grid'], ['list', 'List'], ['week', 'Week']] as const;

/** 上端の右: 番組検索・Grid/List/Week・PC はつまめないので −/＋（Grid / Week だけ） */
export function EpgTopRight({ isPC, scale, setScale }: { isPC: boolean; scale: number; setScale: (f: (z: number) => number) => void }) {
  const { theme, epgView: view, setTweak } = useTheme();
  const { t: tx } = useT();
  return (
    <View style={styles.topRight}>
      <Pressable accessibilityLabel={tx('epg.search')} onPress={() => router.push('/search')}
        style={[styles.searchBtn, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
        <Search s={15} c={theme.ink} />
      </Pressable>
      <View style={[styles.views, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {VIEWS.map(([k, l]) => (
          <Pressable key={k} onPress={() => setTweak('epgView', k)} style={[styles.viewBtn, { backgroundColor: view === k ? theme.ink : 'transparent' }]}>
            <T mono size={10} w={700} color={view === k ? theme.onInk : theme.mute}>{l}</T>
          </Pressable>
        ))}
      </View>
      {isPC && view !== 'list' && (
        <View style={[styles.views, styles.zoom, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <Search s={14} c={theme.mute} />
          <Pressable accessibilityLabel={tx('epg.zoomOut')} onPress={() => setScale((z) => stepScale(z, -1))} style={[styles.zoomBtn, { borderColor: theme.line }]}>
            <T size={15} w={800}>−</T>
          </Pressable>
          <T mono size={9} dim style={styles.zoomPct}>{`${Math.round(scale * 100)}%`}</T>
          <Pressable accessibilityLabel={tx('epg.zoomIn')} onPress={() => setScale((z) => stepScale(z, 1))} style={[styles.zoomBtn, { borderColor: theme.line }]}>
            <Plus s={12} c={theme.ink} w={2.5} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** 帯（地デジ/BS/CS と番組表のアドオン。局の無い帯は出さない）と日付（Week では出さない） */
export function EpgBandBar({ d }: { d: EpgData }) {
  const { theme, accent, epgView: view } = useTheme();
  const { t: tx } = useT();
  return (
    <View style={styles.bar}>
      <View style={[styles.bands, { backgroundColor: theme.surface2, borderColor: theme.frame }]}>
        {[...BANDS.filter(([b]) => d.bands.has(b)).map(([b, k]) => [b, tx(k)] as const), ...(d.guideAddons.data ?? []).map((a) => [guideBand(a.name), a.label || a.name] as const)].map(([b, l]) => (
          <Pressable key={b} onPress={() => d.setBand(b)} style={[styles.band, { backgroundColor: d.band === b ? accent.primary : 'transparent' }]}>
            <T size={11} w={800} color={d.band === b ? '#fff' : theme.ink}>{l}</T>
          </Pressable>
        ))}
      </View>
      {view !== 'week' && (
        <View style={styles.day}>
          <Select label={tx('epg.date')} value={d.day} onChange={d.setDay} options={d.days.map((x) => ({ value: x.ms, label: localizeFmt(x.label) }))} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  views: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10, borderWidth: 1 },
  zoom: { alignItems: 'center' },
  searchBtn: { width: 34, height: 34, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  zoomBtn: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  zoomPct: { minWidth: 30, textAlign: 'center' },
  viewBtn: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 8 },
  bands: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 11, borderWidth: 1.5 },
  band: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  day: { marginLeft: 'auto', width: 150 },
});
