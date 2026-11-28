import { type EncodeRow } from '@tstag/core';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ANDON } from './AndonBoard';
import { openEncoding, useThumb } from '../encodeShared';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { useT } from '../../../ui/i18n/I18n';

/** 終わった時刻（サーバーの現地時刻）。今日なら H:MM、それより前は M/D */
function when(updatedAt: string, today: string): string {
  if (!updatedAt) return '';
  return updatedAt.slice(0, 10) === today ? updatedAt.slice(11, 16) : `${Number(updatedAt.slice(5, 7))}/${Number(updatedAt.slice(8, 10))}`;
}

/** 実績: 終わったものをサムネで並べる。済は緑の縁、失敗は赤い縁と「失敗」（失敗を先に） */
export function AndonHistory({ items, node, today }: { items: EncodeRow[]; node: string | null; today: string }) {
  return (
    <View style={styles.grid}>
      {items.map((e) => <Done key={`${e.isAddon ? 'a' : 'e'}${e.id}`} e={e} node={node} today={today} />)}
    </View>
  );
}

function Done({ e, node, today }: { e: EncodeRow; node: string | null; today: string }) {
  const thumb = useThumb(e, node);
  const { t: tx } = useT();
  const bad = e.status === 'error';
  return (
    <Pressable onPress={() => openEncoding(e)} accessibilityLabel={e.title} style={styles.cell}>
      <View style={[styles.pic, { borderColor: bad ? ANDON.bad : ANDON.run }]}>
        {thumb ? <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.5, 0.12, hueFromId(e.id)) }]} />}
        {bad && <View style={styles.bad}><T size={9} w={900} color="#fff" style={GOTHIC}>{tx('recresult.andon.failed')}</T></View>}
      </View>
      <Num size={10} color="#888">{when(e.updatedAt, today)}</Num>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 18 },
  cell: { width: 76 },
  pic: { width: 76, height: 42.75, borderWidth: 2, overflow: 'hidden', backgroundColor: '#000' },
  bad: { position: 'absolute', left: 0, top: 0, backgroundColor: ANDON.bad, paddingHorizontal: 4 },
});
