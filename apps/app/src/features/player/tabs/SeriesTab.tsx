import { groupDuplicateVideos, type Series, type Video } from '@tstag/core';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DupVideoStack } from '../../library/DupVideoStack';
import { VideoCard } from '../../library/VideoCard';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 再生画面の「シリーズ」: 同じシリーズの話数（重複はライブラリと同じく横に重ねる）。今の話を枠で示す */
export function SeriesTab({ series, currentId, node, onPlay }: {
  series: Series | undefined;
  currentId: number;
  node: string | null;
  onPlay: (v: Video) => void;
}) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  if (!series) return <T size={11} dim style={styles.note}>{tx('common.loading2')}</T>;
  const card = (v: Video) => <VideoCard video={v} node={node} albumName={series.name} onPlay={() => onPlay(v)} />;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      <T mono size={11} dim>{tx('player.seriesTab.eps', { v0: series.name, v1: series.videos.length })}</T>
      {groupDuplicateVideos(series.videos).map((g) => (
        <View key={g[0]!.id} style={g.some((v) => v.id === currentId) && [styles.current, { borderColor: accent.primary }]}>
          {g.length === 1 ? card(g[0]!) : <DupVideoStack videos={g} render={card} />}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 8 },
  note: { padding: 16, lineHeight: 16 },
  // 元は outline 2px・間 2px
  current: { borderWidth: 2, borderRadius: 14, padding: 2, margin: -4 },
});
