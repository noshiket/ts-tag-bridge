import { fmtDur, fmtMs, type CmMarkDecl, type CmResult, type SegChapter, type SplitSource } from '@tstag/core';
import type { SplitEditor } from '@tstag/core/react';
import { useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { keepHoles } from '../common/segmentEditing';
import { splitColors } from '../common/splitColors';
import { ScrollLock } from '../cm/stripTouch';
import { TimelineCmBand } from '../cm/TimelineCmBand';
import { noPan } from '../../../ui/gestures/noPan';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';

/** 録画全体のタイムライン: 話の帯・外す所・隙間・切れ目（ドラッグで動かす / × で消す）・ドロップ・再生位置。押した所へ動く */
export function SplitTimeline({ src, ed, playhead, onSeek, cm, inputChapters, decls }: {
  src: SplitSource; ed: SplitEditor; playhead: number; onSeek: (t: number) => void; cm: CmResult | null; inputChapters: SegChapter[]; decls: CmMarkDecl[];
}) {
  const { theme, accent } = useTheme();
  const total = src.duration;
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<{ idx: number; kind: 'in' | 'out' } | null>(null);
  const start = useRef<{ x: number; t: number } | null>(null);
  const lock = useContext(ScrollLock);
  const pct = (t: number) => `${(t / total) * 100}%` as const;
  const gapShown = (i: number) => !ed.linked && ed.isAdjusted && (ed.gaps[i] || 0) > 0;
  const stop = () => { lock(false); start.current = null; setDrag(null); };
  // 切れ目のつまみ: OUT は話の終わり、IN は隙間の後ろの次の話の始まり
  const handle = (idx: number, kind: 'in' | 'out', t0: number) => ({
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => { lock(true); ed.ensureManualMode(); start.current = { x: e.nativeEvent.pageX, t: t0 }; setDrag({ idx, kind }); },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = start.current;
      if (!s) return;
      const t = s.t + ((e.nativeEvent.pageX - s.x) / width) * total;
      if (kind === 'in') ed.setInAt(idx + 1, t); else ed.setOutAt(idx, t);
    },
    onResponderRelease: stop,
    onResponderTerminate: stop,
  });
  const knob = (i: number, kind: 'in' | 'out', at: number, color: string, label: string, left: number, tip: string) => {
    const dragging = drag?.kind === kind && drag.idx === i;
    return (
      <View key={`${kind}${i}`} pointerEvents="box-none" style={[styles.cut, { left: pct(at), zIndex: dragging ? 10 : 2 }]}>
        <View pointerEvents="none" style={[styles.cutLine, { backgroundColor: color }]} />
        <View {...handle(i, kind, at)} style={[styles.knob, noPan, { left, backgroundColor: dragging ? theme.ink : color, borderColor: theme.frame }]}>
          <T mono size={7} w={800} color={dragging ? color : '#fff'}>{label}</T>
        </View>
        {kind === 'out' && <Pressable onPress={() => ed.removeCut(at)} style={[styles.xBtn, { backgroundColor: splitColors.red, borderColor: theme.frame }]}><T size={8} w={800} color="#fff">×</T></Pressable>}
        {dragging && <View pointerEvents="none" style={[styles.dragTip, { backgroundColor: theme.ink }]}><T mono size={9} w={800} color={theme.onInk}>{`${tip} · ${fmtMs(at)}`}</T></View>}
      </View>
    );
  };
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onResponderRelease={(e) => { if (!drag) onSeek(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)) * total); }}
      style={[styles.timeline, { backgroundColor: theme.surface2, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
      {ed.segments.map((s, i) => {
        const w = ((s.end - s.start) / total) * 100;
        if (w < 0.1) return null;
        const none = !ed.noRemainder && ((ed.remainderAt === 'end' && i === ed.segments.length - 1) || (ed.remainderAt === 'start' && i === 0));
        const ep = ed.remainderAt === 'start' ? i : i + 1;
        return (
          <View key={`s${i}`} pointerEvents="none" style={[styles.band, { left: pct(s.start), width: `${w}%`, borderLeftWidth: i > 0 ? 2 : 0, borderLeftColor: theme.ink,
            backgroundColor: none ? 'rgba(0,0,0,0.14)' : i % 2 ? 'rgba(0,0,0,0.12)' : 'transparent' }]}>
            <View style={[styles.epTag, { backgroundColor: none ? theme.surface2 : oklch(0.85, 0.16, 200), borderColor: none ? theme.line : theme.frame, borderStyle: none ? 'dashed' : 'solid' }]}>
              <T mono size={9} w={800} color={none ? theme.mute : theme.ink}>{none ? 'None' : `#${String(ep).padStart(2, '0')}`}</T>
            </View>
          </View>
        );
      })}
      {cm && <TimelineCmBand cm={cm} total={total} inputChapters={inputChapters} decls={decls} />}
      {ed.segments.map((s, i) => keepHoles(ed.keepList[i] ?? [], s.start, s.end).map(([hs, he], hi) => (
        <View key={`h${i}_${hi}`} pointerEvents="none" style={[styles.hole, { left: pct(hs), width: `${Math.max(0.15, ((he - hs) / total) * 100)}%` }]} />
      )))}
      {ed.cuts.map((c, i) => (gapShown(i) ? (
        <View key={`g${i}`} pointerEvents="none" style={[styles.gap, { left: pct(c), width: `${(ed.gaps[i]! / total) * 100}%`, borderColor: splitColors.red }]}>
          <View style={[styles.gapTag, { backgroundColor: splitColors.redDark }]}><T mono size={7} w={800} color="#fff">{`✕ GAP ${fmtDur(ed.gaps[i]!)}`}</T></View>
        </View>
      ) : null))}
      {src.dropRanges.map(({ start: s0, end: e0 }, i) => (
        <View key={`d${i}`} pointerEvents="none" style={[styles.drop, { left: pct(s0), width: e0 > s0 ? `${((e0 - s0) / total) * 100}%` : 2, minWidth: e0 > s0 ? 3 : undefined }]} />
      ))}
      {ed.cuts.map((c, i) => knob(i, 'out', c, accent.primary, gapShown(i) ? `${i + 1}▼` : String(i + 1).padStart(2, '0'), gapShown(i) ? -18 : -9, 'OUT'))}
      {ed.cuts.map((c, i) => (gapShown(i) ? knob(i, 'in', c + ed.gaps[i]!, accent.tertiary, `▲${i + 2}`, 0, 'IN') : null))}
      <View pointerEvents="none" style={[styles.playhead, { left: pct(playhead) }]}>
        <View style={[styles.phStem, { backgroundColor: theme.ink }]} />
        <View style={[styles.phKnob, { backgroundColor: theme.onInk, borderColor: theme.frame }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { height: 48, borderRadius: 10, borderWidth: 1.5, marginTop: 18 },
  // 細い話（余りの数秒など）の札がタイムラインの外へはみ出さないよう、帯の中で切る
  band: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  epTag: { position: 'absolute', top: 3, left: 3, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, zIndex: 3 },
  hole: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(200,30,40,0.7)', zIndex: 1 },
  gap: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,104,83,0.3)', borderLeftWidth: 1.5, borderRightWidth: 1.5, borderStyle: 'dashed', alignItems: 'center' },
  gapTag: { position: 'absolute', bottom: 2, paddingVertical: 1, paddingHorizontal: 4, borderRadius: 3 },
  drop: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(200,40,40,0.75)' },
  cut: { position: 'absolute', top: -4, bottom: -4, width: 0 },
  cutLine: { position: 'absolute', top: 0, bottom: 0, left: -1.5, width: 3 },
  knob: { position: 'absolute', top: -12, width: 18, height: 14, borderWidth: 1.5, borderTopLeftRadius: 4, borderTopRightRadius: 4, alignItems: 'center', justifyContent: 'center' },
  xBtn: { position: 'absolute', bottom: -12, left: -7, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dragTip: { position: 'absolute', top: -34, left: -40, width: 80, alignItems: 'center', paddingVertical: 2, borderRadius: 5 },
  playhead: { position: 'absolute', top: -6, bottom: -6, width: 0 },
  phStem: { position: 'absolute', top: 0, bottom: 0, left: -1, width: 2 },
  phKnob: { position: 'absolute', top: -6, left: -7, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
