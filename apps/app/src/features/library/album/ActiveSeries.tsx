import { groupDuplicateVideos, type Series, type Video } from '@tstag/core';
import { useMoveSeries, useMoveVideo } from '@tstag/core/react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { DupVideoStack } from '../DupVideoStack';
import { VideoCard } from '../VideoCard';
import { useT } from '../../../ui/i18n/I18n';

/** 選んでいるシリーズの見出し（並び替え ← →）と動画 */
export function ActiveSeries({ albumId, albumName, series, active, node, manualSort, onManual, grouped, videoDesc }: {
  albumId: number;
  albumName: string;
  series: Series[];
  active: Series;
  node: string | null;
  manualSort: boolean;
  onManual: () => void;
  /** 話数順の時は、同じ話をまとめてめくれるようにする */
  grouped: boolean;
  /** 動画を降順で見ているか（並べ替えの向きを逆にする） */
  videoDesc: boolean;
}) {
  const { t: tx } = useT();
  const move = useMoveSeries(albumId);
  const i = series.indexOf(active);
  // 並び替えは設定順の時だけ意味がある。押した時に設定順へ切り替えてから動かす。
  // 他のサーバーのアルバムは並びを変えられない
  const shift = (direction: 'up' | 'down') => {
    if (!manualSort) onManual();
    move.mutate({ seriesId: active.id, direction });
  };
  // 設定順の時は1本ずつ上下に動かせる（降順で見ている時は逆に動かす。元と同じ）
  const moveVideo = useMoveVideo(albumId);
  const card = (v: Video, idx?: number) => (
    <VideoCard video={v} node={node} albumName={albumName} onPlay={() => router.push({ pathname: '/watch/[id]', params: { id: v.id } })}
      onMove={!grouped && !node && idx != null ? (dir) => moveVideo.mutate({ seriesId: active.id, videoId: v.id, direction: videoDesc ? (dir === 'up' ? 'down' : 'up') : dir }) : undefined}
      canMoveUp={idx != null && idx > 0} canMoveDown={idx != null && idx < active.videos.length - 1} />
  );
  return (
    <View>
      <View style={styles.head}>
        <T mono w={800} size={11} dim style={styles.grow}>
          {active.name.toUpperCase()} <T mono size={11} dim>{tx('library.activeSeries.count', { v0: active.videos.length })}</T>
        </T>
        {!node && (
          <View style={styles.moves}>
            <SmallButton label={tx('library.activeSeries.left')} disabled={i === 0} onPress={() => shift('up')} />
            <SmallButton label={tx('library.activeSeries.right')} disabled={i === series.length - 1} onPress={() => shift('down')} />
          </View>
        )}
      </View>
      <View style={styles.videos}>
        {grouped
          ? groupDuplicateVideos(active.videos).map((g) =>
              g.length === 1 ? <View key={g[0]!.id}>{card(g[0]!)}</View> : <DupVideoStack key={`dup-${g[0]!.id}`} videos={g} render={card} />)
          : active.videos.map((v, idx) => <View key={v.id}>{card(v, idx)}</View>)}
      </View>
    </View>
  );
}

function SmallButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[styles.small, { backgroundColor: theme.surface, borderColor: theme.line, opacity: disabled ? 0.4 : 1 }]}>
      <T size={10}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  moves: { flexDirection: 'row', gap: 4 },
  small: { height: 24, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  videos: { gap: 6 },
});
