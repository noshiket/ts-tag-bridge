import type { Recording } from '@tstag/core';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FILM, PEN_FACE, loadPenFace } from './film';

/** サムネに赤ペンで書くドロップ・スクランブル（大きな ✕ と左下の数）。問題が無ければ何も出さない */
export function PenMarks({ r, size = 64 }: { r: Pick<Recording, 'drops' | 'scrambles'>; size?: number }) {
  useEffect(loadPenFace, []);
  const pen = [r.drops ? `DROP ${r.drops.toLocaleString()}` : '', r.scrambles ? `SCR ${r.scrambles.toLocaleString()}` : ''].filter(Boolean).join(' ');
  if (!pen) return null;
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.cross, { fontFamily: PEN_FACE, fontSize: size, lineHeight: size * 1.1 }]}>✕</Text>
      </View>
      <View style={styles.tag}><Text style={[styles.text, { fontFamily: PEN_FACE }]}>{pen}</Text></View>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  cross: { color: FILM.pen },
  tag: { position: 'absolute', left: 4, bottom: 4, backgroundColor: FILM.pen, paddingHorizontal: 5, paddingVertical: 1, transform: [{ rotate: '-3deg' }] },
  text: { fontSize: 13, color: '#fff' },
});
