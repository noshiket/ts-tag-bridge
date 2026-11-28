import { ENCODE_STATE_LABELS, type EncodeRow } from '@tstag/core';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ANDON } from './AndonBoard';
import { openEncoding, useThumb } from '../encodeShared';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { useTheme } from '../../../ui/theme/Tweaks';
import { trLabel, useT } from '../../../ui/i18n/I18n';

/** 待ちの列: ベルトに載った順（実際に始まる順）に横へ流す。番号と、ふつう（3）以外の優先度の札 */
export function AndonBelt({ items, node }: { items: EncodeRow[]; node: string | null }) {
  const { theme } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}
      style={[styles.belt, { borderBottomColor: theme.ink }]}>
      {items.map((e, i) => <Cell key={`${e.isAddon ? 'a' : 'e'}${e.id}`} e={e} n={i + 1} node={node} />)}
    </ScrollView>
  );
}

function Cell({ e, n, node }: { e: EncodeRow; n: number; node: string | null }) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const thumb = useThumb(e, node);
  const prio = e.priority > 3 ? { l: tx('recresult.andon.prioHigh', { n: e.priority }), c: ANDON.bad } : e.priority < 3 ? { l: tx('recresult.andon.prioLow', { n: e.priority }), c: '#666' } : null;
  return (
    <Pressable onPress={() => openEncoding(e)} style={styles.cell}>
      <View style={[styles.pic, { borderColor: theme.frame }]}>
        {thumb ? <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.5, 0.12, hueFromId(e.id)) }]} />}
        <View style={[styles.no, { backgroundColor: theme.ink }]}><Num size={12} color={theme.onInk}>{String(n)}</Num></View>
        {prio && <View style={[styles.prio, { backgroundColor: prio.c }]}><T size={9} w={900} color="#fff" style={GOTHIC}>{prio.l}</T></View>}
      </View>
      <T size={10.5} w={900} numberOfLines={1} style={GOTHIC}>{e.episodeNumber ? `${e.title} #${e.episodeNumber}` : e.title}</T>
      <T size={9.5} dim style={GOTHIC}>{trLabel(tx, 'state.enc', e.state, ENCODE_STATE_LABELS)}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  belt: { borderBottomWidth: 6 },
  row: { gap: 8, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8 },
  cell: { width: 120 },
  pic: { width: 120, height: 67.5, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  no: { position: 'absolute', left: 0, top: 0, paddingHorizontal: 5 },
  prio: { position: 'absolute', right: 0, top: 0, paddingHorizontal: 4, paddingVertical: 1 },
});
