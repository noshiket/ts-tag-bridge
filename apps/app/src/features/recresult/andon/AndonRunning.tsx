import { ENCODE_STATE_LABELS, encodeRemainingSec, type EncodeRow } from '@tstag/core';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ANDON } from './AndonBoard';
import { openEncoding, useThumb } from '../encodeShared';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { useTheme } from '../../../ui/theme/Tweaks';
import { trLabel, useT } from '../../../ui/i18n/I18n';

/** 実行中の 1 本を大きく: サムネ・進み具合の太い線・題名と、実測の残り時間（出せない間は工程の名前） */
export function AndonRunning({ e, node, now }: { e: EncodeRow; node: string | null; now: number }) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const thumb = useThumb(e, node);
  const left = encodeRemainingSec(e, now);
  const encoding = e.state === 'encoding';
  return (
    <Pressable onPress={() => openEncoding(e)} style={[styles.box, { borderColor: theme.frame, backgroundColor: theme.surface }]}>
      <View style={styles.pic}>
        {thumb ? <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.5, 0.12, hueFromId(e.id)) }]} />}
        {encoding && <View style={[styles.pct, { backgroundColor: ANDON.run }]}><Num size={28} color="#fff">{`${Math.round(e.progress * 100)}%`}</Num></View>}
      </View>
      <View style={[styles.bar, { backgroundColor: theme.surface2 }]}>
        <View style={{ width: `${(encoding ? e.progress : 0) * 100}%`, height: '100%', backgroundColor: ANDON.run }} />
      </View>
      <View style={styles.meta}>
        <T size={14} w={900} numberOfLines={1} style={[GOTHIC, styles.title]}>{e.episodeNumber ? `${e.title} #${e.episodeNumber}` : e.title}</T>
        <T size={11} w={700} dim style={GOTHIC}>
          {left != null ? tx('recresult.andon.left', { n: Math.max(1, Math.round(left / 60)) }) : trLabel(tx, 'state.enc', e.state, ENCODE_STATE_LABELS)}
        </T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2 },
  pic: { aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  pct: { position: 'absolute', right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 2 },
  bar: { height: 10 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  title: { flex: 1, minWidth: 0 },
});
