import type { AddonChannel } from '@tstag/core';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import type { EpgData } from './useEpgData';
import { StationLogo } from '../../../ui/parts/StationLogo';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { bandColor } from '../colors';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 局のタブ（ロゴがあればロゴ）。押すとその局を選び、Grid ならその列へ寄せる */
export function ChannelTabs({ d, onPick }: { d: EpgData; onPick: (index: number) => void }) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const { groups } = d;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsIn}>
      {groups.length === 0 ? <T mono size={11} dim style={styles.empty}>{d.guideName ? tx(d.events.loading ? 'common.loading' : 'epg.noStations') : d.channels.length === 0 ? tx('common.loading') : tx('epg.bandNoStations', { band: d.band.toUpperCase() })}</T>
        : groups.map((g, i) => {
          const active = g.id === d.activeCh;
          const logoUrl = (g as Partial<AddonChannel>).logoUrl ?? null;
          const hasLogo = !!logoUrl || !!d.logos.data?.has(`${g.onid}-${g.sid}`);
          return (
            <Pressable key={g.id} onPress={() => { d.setActiveCh(g.id); onPick(i); }}
              style={[styles.tab, {
                backgroundColor: active ? bandColor(g.hue, theme) : hasLogo ? 'transparent' : theme.surface,
                borderColor: hasLogo ? 'transparent' : theme.frame, boxShadow: active || hasLogo ? 'none' : shadow(theme, 2),
              }]}>
              {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="contain" />
                : hasLogo ? <StationLogo onid={g.onid} sid={g.sid} height={26} maxWidth={44} />
                : <T size={11} w={800} color={active ? '#fff' : theme.ink} numberOfLines={1}>{g.short}</T>}
            </Pressable>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexGrow: 0, marginBottom: 10 },
  tabsIn: { gap: 4, paddingHorizontal: 18, paddingBottom: 6 },
  empty: { paddingVertical: 6 },
  logo: { width: 44, height: 26 },
  tab: { minWidth: 54, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
