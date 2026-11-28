import { fmtDur, fmtMs, type SplitSegment } from '@tstag/core';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { keepHoles } from '../common/segmentEditing';
import { ScrubCmOverlay } from '../cm/SegmentCmBands';
import type { SplitScreenState } from './useSplitScreen';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/**
 * 話のスクラブバー（押した所へ）: 再生位置、外す所、置きかけのトリムの IN / OUT、CM解析を重ねる。
 * 押した位置は responder の locationX で取る（Web の Pressable の押下には位置が入らない）
 */
export function SegmentScrubBar({ s, seg, i }: { s: SplitScreenState; seg: SplitSegment; i: number }) {
  const { theme, accent } = useTheme();
  const w = useRef(1);
  const dur = seg.end - seg.start;
  const at = (t: number) => `${((t - seg.start) / Math.max(1, dur)) * 100}%` as const;
  const inSeg = s.playhead >= seg.start && s.playhead <= seg.end;
  const mp = s.ed.pendingKeep?.segIdx === i ? s.ed.pendingKeep : null;
  return (
    <View onLayout={(e) => { w.current = e.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onResponderRelease={(e) => s.seek(seg.start + Math.max(0, Math.min(1, e.nativeEvent.locationX / (w.current || 1))) * dur)}
      style={[styles.scrub, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      {inSeg && <View pointerEvents="none" style={[styles.fill, { width: at(s.playhead), backgroundColor: `${accent.primary}30` }]} />}
      {inSeg && <View pointerEvents="none" style={[styles.line, { left: at(s.playhead), backgroundColor: accent.primary }]} />}
      {keepHoles(s.ed.keepList[i] ?? [], seg.start, seg.end).map(([hs, he], hi) => (
        <View key={hi} pointerEvents="none" style={[styles.hole, { left: at(hs), right: `${((seg.end - he) / Math.max(1, dur)) * 100}%` }]} />
      ))}
      {mp?.in != null && <View pointerEvents="none" style={[styles.line, { left: at(mp.in), backgroundColor: accent.primary }]} />}
      {mp?.out != null && <View pointerEvents="none" style={[styles.line, { left: at(mp.out), backgroundColor: accent.primary }]} />}
      {s.cmq.cm && <ScrubCmOverlay cm={s.cmq.cm} seg={seg} manual={s.ed.manualMutes[i] ?? []} decls={s.cmq.decls} />}
      <View pointerEvents="none" style={styles.labels}>
        <T mono size={8} dim>{fmtMs(seg.start)}</T>
        <T mono size={9} w={800} color={inSeg ? accent.primary : theme.mute}>{inSeg ? fmtMs(s.playhead - seg.start) : fmtDur(dur)}</T>
        <T mono size={8} dim>{fmtMs(seg.end)}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrub: { height: 28, borderRadius: 7, overflow: 'hidden', borderWidth: 1.5 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  hole: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(200,30,40,0.45)' },
  labels: { position: 'absolute', top: 0, bottom: 0, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
