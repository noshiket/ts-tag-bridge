import { type AlbumSummary } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AlbumImage, AlbumMarks, gridCells } from './albumParts';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const GAP = 14;
const STEP = 5;

/** M/D（最後に見た日。サーバーは UTC で返すので端末の時刻に直す） */
const md = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

/**
 * アルバムの重ね表示: 期（シリーズ）の数だけサムネの後ろに板を重ね（4 枚まで）、話数を大きく。
 * 下に題名 1 行と、見たことがあれば「M/D に見た」（事実だけ）
 */
export function AlbumStacks({ items, node, inMylist, onOpen, onMenu }: {
  items: AlbumSummary[];
  node: string | null;
  inMylist: (id: number) => boolean;
  onOpen: (a: AlbumSummary) => void;
  onMenu?: (a: AlbumSummary) => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const [w, setW] = useState(0);
  const { cellW } = gridCells(w, GAP, 220, 2);
  return (
    <View style={styles.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {items.map((a) => {
        const seasons = Math.max(1, a.series_names?.length ?? 1);
        const layers = Math.min(seasons, 4) - 1;
        return (
          <Pressable key={a.id} onPress={() => onOpen(a)} onLongPress={onMenu ? () => onMenu(a) : undefined}
            accessibilityLabel={a.name} style={{ width: cellW }}>
            <View style={[styles.stack, { marginTop: 3 * STEP, marginRight: 3 * STEP }]}>
              {Array.from({ length: layers }, (_, i) => layers - i).map((k) => (
                <View key={k} style={[styles.layer, {
                  transform: [{ translateX: k * STEP }, { translateY: -k * STEP }],
                  backgroundColor: theme.surface2, borderColor: theme.frame, opacity: 1 - k * 0.12,
                }]} />
              ))}
              <View style={[styles.cover, { borderColor: theme.frame }]}>
                <AlbumImage album={a} node={node} />
                <View style={styles.big}>
                  <Num size={20} color="#fff">{String(a.video_count)}</Num>
                  <T size={9} w={700} color="#ccc" style={GOTHIC}>{seasons > 1 ? tx('library.album.epsSeasons', { n: seasons }) : tx('library.album.eps', { n: a.video_count })}</T>
                </View>
                <AlbumMarks album={a} inMylist={inMylist(a.id)} />
              </View>
            </View>
            <T size={12} w={900} numberOfLines={1} style={[GOTHIC, styles.title]}>{a.name}</T>
            {!!a.latest_watch_at && <Num size={10} color={theme.mute}>{tx('library.album.watchedOn', { date: md(a.latest_watch_at) })}</Num>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: GAP, rowGap: 12 },
  stack: { aspectRatio: 16 / 9 },
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 1 },
  cover: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  big: { position: 'absolute', right: 0, bottom: 0, flexDirection: 'row', alignItems: 'baseline', gap: 2, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 6, paddingBottom: 2 },
  title: { marginTop: 5 },
});
