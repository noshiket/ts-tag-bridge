import { fmtMs, muteJump, muteJumpFrame, nearestMark, segMarks, type CmMarkDecl, type CmResult, type Mark, type SplitSegment, type TimeRange } from '@tstag/core';
import { useContext, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent, type ScrollViewInstance } from 'react-native';

import { MARK, markColor } from './cmColors';
import { LENS_R, ScrollLock, ratioOf, stripStyles as ss } from './stripTouch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { noPan } from '../../../ui/gestures/noPan';
import { useT } from '../../../ui/i18n/I18n';

/** ▼のルーペに出す個数（前後あわせて） */
const LENS_NEAR = 7;
/** ▼の下の並びの1つの幅と間 */
const PIN_W = 58;
const PIN_GAP = 4;

/**
 * 無音区間などの区切りへ飛ぶ▼の帯。密集していて押し分けられないので、なぞっている間はルーペで
 * 近くの区切りを等間隔に並べて見せ、離した所に一番近い区切りへ飛ぶ（元はマウスのホバーでルーペ）。
 * 帯の下に区切りを全部並べておく（横にスライド・◀▶で1つずつ飛ぶ）。スマホではルーペは指を置いている間しか
 * 出ないので、細かく選べなかった。▼を押して離した時は並びをその位置へ送るだけ（飛ばない）、なぞった時は飛ぶ
 */
export function MarkStrip({ cm, seg, manual, onJump, decls }: { cm: CmResult | null; seg: SplitSegment; manual: TimeRange[]; onJump: (t: number, frame?: number) => void; decls: CmMarkDecl[] }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const marks = segMarks(cm, seg, decls);
  const dur = Math.max(1, seg.end - seg.start);
  const [w, setW] = useState(1);
  const [lens, setLens] = useState<{ x: number; ratio: number; hit: number } | null>(null);
  /** 最後に飛んだ区切り（塗り） */
  const [sel, setSel] = useState(-1);
  /** ▼を押して並びを送った先（枠） */
  const [focus, setFocus] = useState(-1);
  const downX = useRef(0);
  const row = useRef<ScrollViewInstance>(null);
  const [rowW, setRowW] = useState(0);
  const lock = useContext(ScrollLock);
  if (!marks.length) return null;
  const at = (e: GestureResponderEvent) => { const r = ratioOf(e, w); return { x: r * w, ratio: r, hit: nearestMark(marks, seg.start + r * dur) }; };
  const hit = lens && lens.hit >= 0 ? marks[lens.hit] : null;
  const color = (m: Mark, on: boolean) => (on ? theme.ink : m.by ? markColor(m.by) : MARK.mute);
  const near = lens ? marks.map((_, i) => i).sort((a, b) => Math.abs(marks[a]!.start - (seg.start + lens.ratio * dur)) - Math.abs(marks[b]!.start - (seg.start + lens.ratio * dur))).slice(0, LENS_NEAR).sort((a, b) => a - b) : [];
  const center = (i: number) => row.current?.scrollTo({ x: Math.max(0, i * (PIN_W + PIN_GAP) - rowW / 2 + PIN_W / 2), animated: true });
  const jump = (i: number) => { setSel(i); setFocus(i); center(i); onJump(muteJump(marks[i]!), muteJumpFrame(marks[i]!)); };
  const step = (d: number) => { const b = sel >= 0 ? sel : focus >= 0 ? focus : d > 0 ? -1 : marks.length; const i = b + d; if (i >= 0 && i < marks.length) jump(i); };
  const base = sel >= 0 ? sel : focus;
  const slot = (2 * LENS_R - 16) / Math.max(1, near.length);
  const left = (t: number) => `${((t - seg.start) / dur) * 100}%` as const;
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width || 1)} style={[styles.strip, noPan]}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => { lock(true); downX.current = e.nativeEvent.pageX; setLens(at(e)); }} onResponderMove={(e) => setLens(at(e))}
        onResponderRelease={(e) => {
          const a = at(e);
          lock(false); setLens(null);
          if (a.hit < 0) return;
          if (Math.abs(e.nativeEvent.pageX - downX.current) < 8) { setFocus(a.hit); center(a.hit); return; }
          jump(a.hit);
        }}
        onResponderTerminate={() => { lock(false); setLens(null); }}>
        {marks.map((m, i) => <View key={i} pointerEvents="none" style={[styles.tri, { left: left(muteJump(m)), borderTopColor: color(m, lens?.hit === i) }]} />)}
        {marks.map((m, i) => (m.also ? <View key={`s${i}`} pointerEvents="none" style={[styles.triSmall, { left: left(muteJump(m)), borderTopColor: markColor(m.also) }]} /> : null))}
        {manual.filter((m) => m.from > seg.start && m.from < seg.end).map((m, i) => (
          <View key={`u${i}`} pointerEvents="none" style={[styles.tri, { left: left(m.from), borderTopColor: MARK.manual }]} />
        ))}
        {lens && near.length > 0 && (
          <View pointerEvents="none" style={[ss.lens, { left: Math.max(0, Math.min(w - LENS_R * 2, lens.x - LENS_R)), borderColor: theme.frame, backgroundColor: theme.surface }]}>
            <View style={styles.lensRow}>
              {near.map((mi, k) => {
                const m = marks[mi]!;
                const on = mi === lens.hit;
                return (
                  <View key={mi} style={[styles.lensSlot, { left: k * slot, width: slot }]}>
                    <View style={{ width: on ? 4 : 2, height: on ? 20 : 13, borderRadius: 1, opacity: on ? 1 : 0.45, backgroundColor: m.by ? markColor(m.by) : on ? MARK.mute : theme.ink }} />
                    {on && <T mono size={7}>{fmtMs(muteJump(m) - seg.start)}</T>}
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
      {hit && <T mono size={8} style={ss.mt2}>{tx('split.markStrip.releaseJumpHere', { v0: hit.by ? hit.by.short ?? hit.by.label : tx('common.silent'), v1: fmtMs(muteJump(hit) - seg.start) })}</T>}
      <View style={[styles.pinRow, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
        <Pressable onPress={() => step(-1)} disabled={base === 0} accessibilityLabel={tx('split.markStrip.previousMark')} hitSlop={4}
          style={[styles.pinStep, { borderColor: theme.line, opacity: base === 0 ? 0.35 : 1 }]}><T size={11} w={800}>◀</T></Pressable>
        <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
          style={ss.grow} contentContainerStyle={styles.pinList}>
          {marks.map((m, mi) => {
            const on = mi === sel;
            return (
              <Pressable key={mi} onPress={() => jump(mi)} accessibilityRole="button"
                style={({ pressed }) => [styles.pinItem, {
                  borderColor: on || mi === focus ? theme.ink : theme.line, borderWidth: mi === focus && !on ? 1.5 : 1,
                  backgroundColor: on ? theme.ink : pressed ? theme.surface : 'transparent',
                }]}>
                <View style={[styles.pinBar, { backgroundColor: m.by ? markColor(m.by) : MARK.mute }]} />
                <T mono size={8} numberOfLines={1} color={on ? theme.surface : undefined}>{fmtMs(muteJump(m) - seg.start).replace(/^00:/, '').replace(/^0(?=\d:)/, '').slice(0, -1)}</T>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={() => step(1)} disabled={base === marks.length - 1} accessibilityLabel={tx('split.markStrip.nextMark')} hitSlop={4}
          style={[styles.pinStep, { borderColor: theme.line, opacity: base === marks.length - 1 ? 0.35 : 1 }]}><T size={11} w={800}>▶</T></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { height: 12, position: 'relative' },
  pinRow: { flexDirection: 'row', alignItems: 'stretch', gap: 3, marginTop: 4, padding: 3, borderRadius: 7, borderWidth: 1 },
  pinList: { gap: PIN_GAP },
  pinItem: { width: PIN_W, alignItems: 'center', gap: 3, paddingVertical: 6, borderRadius: 5 },
  pinBar: { width: 3, height: 12, borderRadius: 1 },
  pinStep: { justifyContent: 'center', paddingHorizontal: 9, borderRadius: 5, borderWidth: 1 },
  tri: { position: 'absolute', top: 2, marginLeft: -3.5, width: 0, height: 0, borderLeftWidth: 3.5, borderRightWidth: 3.5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  triSmall: { position: 'absolute', top: 8, marginLeft: -2.5, width: 0, height: 0, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 4, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#888' },
  lensRow: { position: 'absolute', left: 8, right: 8, top: LENS_R - 17, height: 34 },
  lensSlot: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
