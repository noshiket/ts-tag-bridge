import type { AlbumSummary } from '@tstag/core';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AlbumImage, AlbumMarks, gridCells } from './albumParts';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

const GAP = 4;

/** アルバムのタイル表示: 絵の壁。字は絵の下端の題名 1 行と、右上の話数だけ。長押しで操作のシート */
export function AlbumTiles({ items, node, inMylist, onOpen, onMenu }: {
  items: AlbumSummary[];
  node: string | null;
  inMylist: (id: number) => boolean;
  onOpen: (a: AlbumSummary) => void;
  onMenu?: (a: AlbumSummary) => void;
}) {
  const [w, setW] = useState(0);
  const { t: tx } = useT();
  const { cellW } = gridCells(w, GAP, 150, 3);
  return (
    <View style={styles.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {items.map((a) => (
        <Pressable key={a.id} onPress={() => onOpen(a)} onLongPress={onMenu ? () => onMenu(a) : undefined}
          accessibilityLabel={a.name} style={[styles.tile, { width: cellW }]}>
          <AlbumImage album={a} node={node} />
          <View style={styles.count}><Num size={13} color="#fff">{String(a.video_count)}</Num><T size={8} w={700} color="#fff" style={GOTHIC}>{tx('library.album.eps', { n: a.video_count })}</T></View>
          <AlbumMarks album={a} inMylist={inMylist(a.id)} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.titleBand}>
            <T size={9.5} w={700} color="#fff" numberOfLines={1} style={GOTHIC}>{a.name}</T>
          </LinearGradient>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GAP },
  tile: { aspectRatio: 16 / 9, overflow: 'hidden', backgroundColor: '#000' },
  count: { position: 'absolute', right: 0, top: 0, flexDirection: 'row', alignItems: 'baseline', gap: 1, backgroundColor: 'rgba(0,0,0,0.78)', paddingHorizontal: 4, paddingBottom: 1 },
  titleBand: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 4, paddingBottom: 2 },
});
