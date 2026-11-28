import type { Series } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** アルバムの中のシリーズを横に並べて選ぶ（元の Web 版のカルーセル） */
export function SeriesCarousel({ series, activeId, node, onSelect }: {
  series: Series[];
  activeId: number;
  node: string | null;
  onSelect: (id: number) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {series.map((s) => <SeriesCard key={s.id} s={s} selected={s.id === activeId} node={node} onPress={() => onSelect(s.id)} />)}
    </ScrollView>
  );
}

function SeriesCard({ s, selected, node, onPress }: { s: Series; selected: boolean; node: string | null; onPress: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [failed, setFailed] = useState(false);
  // シリーズのサムネが無ければ、中の動画から1本選んで代わりにする（再描画でちらつかないよう番号で決める）
  const uri = api.library.seriesThumbnailUrlFor(s, node)
    ?? (s.videos.length ? api.library.videoThumbnailUrl(s.videos[s.id % s.videos.length]!.id, node) : null);
  return (
    <Pressable onPress={onPress} style={[styles.card, {
      backgroundColor: theme.surface, borderColor: selected ? theme.ink : theme.line,
      boxShadow: selected ? shadow(theme, 3, accent.primary) : undefined,
    }]}>
      <View style={[styles.thumb, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
        {uri && !failed ? (
          <Image source={{ uri, headers: api.client.authHeaders() }} style={StyleSheet.absoluteFill} contentFit="cover"
            cachePolicy="memory-disk" onError={() => setFailed(true)} />
        ) : !uri ? <T size={16}>🎬</T> : null}
      </View>
      <T size={10} w={700} numberOfLines={2} color={selected ? theme.ink : theme.mute} style={styles.name}>{s.name}</T>
      <T mono size={9} dim>{tx('common.videos', { v0: s.videos.length })}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingHorizontal: 2, paddingTop: 2, paddingBottom: 6 },
  card: { width: 118, borderRadius: 12, padding: 6, borderWidth: 1.5 },
  thumb: { width: '100%', height: 60, borderRadius: 8, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 5, lineHeight: 13, height: 26 },
});
