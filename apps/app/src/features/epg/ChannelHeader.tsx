import type { ChannelGroup } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { bandColor } from './colors';
import { HEADER_H } from './EpgGrid';

/** 番組表の局の見出し（ロゴのある局はロゴだけ、無い局は色の帯に局名と sid。元と同じ） */
export function ChannelHeader({ g, hasLogo, width, logoUrl }: { g: ChannelGroup; hasLogo: boolean; width: number;
  /** 番組表のアドオンの局のロゴ（アドオンが返した画像の URL） */
  logoUrl?: string | null }) {
  const api = useApi();
  const { theme } = useTheme();
  return (
    <View style={[styles.cell, { backgroundColor: hasLogo || logoUrl ? theme.bg : bandColor(g.hue, theme) }]}>
      {logoUrl ? (
        <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" />
      ) : hasLogo ? (
        <Image source={{ uri: api.client.url(`/api/logo?onid=${g.onid}&sid=${g.sid}&v=3`), headers: api.client.authHeaders() }}
          style={styles.logo} contentFit="contain" cachePolicy="memory-disk" />
      ) : (
        <View>
          <T size={11} w={800} color="#fff" numberOfLines={1} style={{ maxWidth: width - 50 }}>{g.name}</T>
          {g.sid > 0 && <T mono size={8} color="rgba(255,255,255,0.75)">{`sid:${g.sid}`}</T>}
        </View>
      )}
    </View>
  );
}

/** Week の日の見出し */
export function DayHeader({ label }: { label: string }) {
  const { theme } = useTheme();
  return <View style={[styles.cell, { backgroundColor: theme.surface2 }]}><T mono size={10} w={800}>{label}</T></View>;
}

const styles = StyleSheet.create({
  cell: { height: HEADER_H - 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  logo: { width: 64, height: HEADER_H - 6 },
});
