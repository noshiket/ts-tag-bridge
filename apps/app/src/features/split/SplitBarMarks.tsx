import type { SplitEditor } from '@tstag/core/react';
import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { T } from '../../ui/parts/T';
import { noPan } from '../../ui/gestures/noPan';

const AMBER = '#f59e0b';
const CYAN = '#22d3ee';

/**
 * 分割タブを開いている間、シークバーに重ねるもの（元の stream.jsx のタイムライン重畳）:
 * 話の範囲の帯と番号、トリムで外す所（赤）、話の間の隙間、切れ目の OUT つまみ（つながっていない時は IN つまみも）
 */
export function SplitBarMarks({ editor, duration, barWidth }: { editor: SplitEditor; duration: number; barWidth: number }) {
  const [drag, setDrag] = useState<{ idx: number; kind: 'in' | 'out' } | null>(null);
  const start = useRef<{ x: number; t: number } | null>(null);
  if (!(duration > 0)) return null;
  const pct = (t: number) => `${(t / duration) * 100}%` as const;

  // つまみ: 押した所からの指の動きを時間に直す（つまみの中の位置ではバー上の位置が分からないため）
  const handle = (idx: number, kind: 'in' | 'out', t0: number) => ({
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => { start.current = { x: e.nativeEvent.pageX, t: t0 }; setDrag({ idx, kind }); },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = start.current;
      if (!s || !(barWidth > 0)) return;
      const t = s.t + ((e.nativeEvent.pageX - s.x) / barWidth) * duration;
      if (kind === 'in') editor.setInAt(idx + 1, t); else editor.setOutAt(idx, t);
    },
    onResponderRelease: () => { start.current = null; setDrag(null); },
    onResponderTerminate: () => { start.current = null; setDrag(null); },
  });

  return (
    <>
      {/* 話の範囲の帯。番号は区間の真ん中に置く（切れ目に置くとどこからどこまでか分からない） */}
      {editor.segments.map((sg, i) => {
        const w = ((sg.end - sg.start) / duration) * 100;
        if (!(w > 0.1)) return null;
        const none = !editor.noRemainder && ((editor.remainderAt === 'end' && i === editor.segments.length - 1) || (editor.remainderAt === 'start' && i === 0));
        const ep = editor.remainderAt === 'start' ? i : i + 1;
        return (
          <View key={`b${i}`} pointerEvents="none" style={[styles.band, { left: pct(sg.start), width: `${w}%`,
            backgroundColor: none ? 'rgba(255,255,255,0.10)' : 'rgba(245,158,11,0.22)', borderColor: none ? 'rgba(255,255,255,0.3)' : 'rgba(245,158,11,0.85)', borderStyle: none ? 'dashed' : 'solid' }]}>
            <T mono size={8} w={800} color="#fff" numberOfLines={1} style={styles.shadow}>{none ? '×' : `#${String(ep).padStart(2, '0')}`}</T>
          </View>
        );
      })}
      {/* トリムで外す所（採用区間の外）。採用区間が0個の話は全体を採用 */}
      {editor.segments.map((sg, i) => {
        const keeps = [...(editor.keepList[i] ?? [])].sort((a, b) => a.from - b.from);
        if (!keeps.length) return null;
        const holes: [number, number][] = [];
        let cur = sg.start;
        for (const k of keeps) { if (cur < k.from) holes.push([cur, Math.min(k.from, sg.end)]); cur = Math.max(cur, k.to); }
        if (cur < sg.end) holes.push([cur, sg.end]);
        return holes.map(([hs, he], hi) => (
          <View key={`h${i}_${hi}`} pointerEvents="none" style={[styles.hole, { left: pct(hs), width: `${Math.max(0.2, ((he - hs) / duration) * 100)}%` }]} />
        ));
      })}
      {editor.gaps.map((g, i) => (g > 0 ? <View key={`g${i}`} pointerEvents="none" style={[styles.gap, { left: pct(editor.cuts[i]!), width: `${(g / duration) * 100}%` }]} /> : null))}
      {editor.cuts.map((c, i) => {
        const on = drag?.kind === 'out' && drag.idx === i;
        return (
          <View key={`c${i}`} style={[styles.cut, { left: pct(c), zIndex: on ? 12 : 6 }]} pointerEvents="box-none">
            <View pointerEvents="none" style={styles.cutLine} />
            <View {...handle(i, 'out', c)} style={[styles.outKnob, noPan, { backgroundColor: on ? '#fff' : AMBER }]}>
              <T mono size={8} w={800} color="#000">↕</T>
            </View>
          </View>
        );
      })}
      {!editor.linked && editor.cuts.map((c, i) => {
        const g = editor.gaps[i] || 0;
        if (g <= 0) return null;
        const on = drag?.kind === 'in' && drag.idx === i;
        return (
          <View key={`i${i}`} {...handle(i, 'in', c + g)} style={[styles.inKnob, noPan, { left: pct(c + g), backgroundColor: on ? '#fff' : CYAN }]}>
            <T mono size={8} w={800} color="#000">▲</T>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: -14, height: 12, borderRadius: 3, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 3 },
  hole: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(239,68,68,0.75)', zIndex: 3 },
  gap: { position: 'absolute', top: 1, bottom: 1, backgroundColor: 'rgba(239,68,68,0.4)', zIndex: 4 },
  cut: { position: 'absolute', top: -5, bottom: -5, width: 0 },
  cutLine: { position: 'absolute', top: 0, bottom: 0, left: -1.5, width: 3, backgroundColor: AMBER },
  outKnob: { position: 'absolute', top: -27, left: -7, width: 14, height: 12, borderTopLeftRadius: 4, borderTopRightRadius: 4, alignItems: 'center', justifyContent: 'center' },
  inKnob: { position: 'absolute', bottom: -13, marginLeft: -8, width: 16, height: 14, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, alignItems: 'center', justifyContent: 'center', zIndex: 7 },
});
