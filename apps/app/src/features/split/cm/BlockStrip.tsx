import { blockSummary, blocksIn, chapterName, chapterNameAt, fmtDur, fmtMs, isCmLabel, isKeptBlock, type Block, type CmResult, type KeepRange, type SegChapter, type SplitSegment, type TimeRange } from '@tstag/core';
import { useContext, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { CM_ORANGE } from './cmColors';
import { DRAG_MIN_PX, LENS_R, LENS_ZOOM, ScrollLock, ratioOf, stripStyles as ss } from './stripTouch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { noPan } from '../../../ui/gestures/noPan';
import { useT } from '../../../ui/i18n/I18n';

/**
 * CM解析のブロック帯。押すと一番近いブロックの採用/除外が反転し、なぞると範囲ごと反転する（隣り合う採用は1区間にまとまる）。
 * 狭いブロックは狙えないので、触っている間はルーペで拡大して見せる
 */
export function BlockStrip({ cm, seg, segIdx, keeps, manual, chapters, onFlip }: {
  cm: CmResult | null; seg: SplitSegment; segIdx: number; keeps: KeepRange[]; manual: TimeRange[]; chapters: SegChapter[];
  onFlip: (segIdx: number, blocks: Block[], hit: (b: Block) => boolean) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const list = blocksIn(cm, seg, manual);
  const dur = Math.max(1, seg.end - seg.start);
  const [w, setW] = useState(1);
  const [lens, setLens] = useState<{ x: number; ratio: number; hit: number } | null>(null);
  const drag = useRef<{ from: number; fromX: number; to: number; toX: number } | null>(null);
  const [dragShow, setDragShow] = useState<{ from: number; to: number } | null>(null);
  const lock = useContext(ScrollLock);
  if (!list.length) return null;
  const nearestAt = (ratio: number) => {
    const t = seg.start + ratio * dur;
    let best = 0;
    let bd = Infinity;
    list.forEach((c, i) => { const d = t < c.start ? c.start - t : t > c.end ? t - c.end : 0; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const nm = (t: number) => chapterNameAt(chapters, keeps, seg.start, t);
  const at = (e: GestureResponderEvent) => { const r = ratioOf(e, w); return { x: r * w, ratio: r, hit: nearestAt(r), t: seg.start + r * dur, px: e.nativeEvent.pageX }; };
  const blockStyle = (c: Block, i: number, scale: number, minPx: number) => {
    const kept = isKeptBlock(keeps, c);
    return {
      position: 'absolute' as const, top: 0, bottom: 0, left: ((c.start - seg.start) / dur) * w * scale, width: Math.max(minPx, ((c.end - c.start) / dur) * w * scale),
      borderRightWidth: 1, borderRightColor: theme.surface, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
      borderWidth: lens?.hit === i ? 2 : 0, borderColor: theme.frame,
      backgroundColor: kept ? (isCmLabel(c.label) ? CM_ORANGE : accent.primary) : theme.line,
    };
  };
  const label = (c: Block, room: number, min: number) => (room > min ? nm(c.start) || chapterName(c.label) : '');
  const end = () => { lock(false); drag.current = null; setDragShow(null); setLens(null); };
  const hitC = lens ? list[lens.hit] : null;
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width || 1)} style={[styles.strip, noPan, { backgroundColor: theme.surface2 }]}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => { lock(true); const a = at(e); setLens(a); drag.current = { from: a.t, fromX: a.px, to: a.t, toX: a.px }; }}
        onResponderMove={(e) => {
          const a = at(e);
          setLens(a);
          if (drag.current) { drag.current = { ...drag.current, to: a.t, toX: a.px }; if (Math.abs(a.px - drag.current.fromX) >= DRAG_MIN_PX) setDragShow({ from: drag.current.from, to: a.t }); }
        }}
        onResponderRelease={(e) => {
          const d = drag.current;
          const a = at(e);
          end();
          if (!d) return;
          // ほとんど動いていなければ「押した」＝一番近い1つだけ反転
          if (Math.abs(a.px - d.fromX) < DRAG_MIN_PX) { const b = list[a.hit]!; onFlip(segIdx, list, (x) => x.start === b.start); }
          else { const lo = Math.min(d.from, a.t); const hi = Math.max(d.from, a.t); onFlip(segIdx, list, (x) => x.end > lo && x.start < hi); }
        }}
        onResponderTerminate={end}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
          {list.map((c, i) => (
            <View key={i} style={blockStyle(c, i, 1, 1)}>
              <T mono size={7} w={800} color={isKeptBlock(keeps, c) ? '#fff' : theme.mute} numberOfLines={1}>{label(c, ((c.end - c.start) / dur) * 100, 8)}</T>
            </View>
          ))}
        </View>
        {dragShow && (
          <View pointerEvents="none" style={[styles.dragRange, { borderColor: theme.frame, left: `${((Math.min(dragShow.from, dragShow.to) - seg.start) / dur) * 100}%`, width: `${(Math.abs(dragShow.to - dragShow.from) / dur) * 100}%` }]} />
        )}
        {lens && (
          // ルーペ: 同じ帯を LENS_ZOOM 倍に伸ばし、指の位置が円の真ん中に来るようずらす
          <View pointerEvents="none" style={[ss.lens, { left: lens.x - LENS_R, borderColor: theme.frame, backgroundColor: theme.surface }]}>
            <View style={styles.lensBlocks}>
              <View style={{ position: 'absolute', top: 0, bottom: 0, width: w * LENS_ZOOM, left: LENS_R - lens.ratio * w * LENS_ZOOM }}>
                {list.map((c, i) => (
                  <View key={i} style={blockStyle(c, i, LENS_ZOOM, 3)}>
                    <T mono size={8} w={800} color={isKeptBlock(keeps, c) ? '#fff' : theme.mute} numberOfLines={1}>{label(c, ((c.end - c.start) / dur) * w * LENS_ZOOM, 22)}</T>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.lensCenter, { backgroundColor: theme.ink }]} />
          </View>
        )}
      </View>
      {hitC && (
        <T mono size={8} style={ss.mt2}>{tx('split.blockStrip.release', { v0: nm(hitC.start) || chapterName(hitC.label), v1: fmtMs(hitC.start), v2: fmtMs(hitC.end), v3: fmtDur(hitC.end - hitC.start), v4: isKeptBlock(keeps, hitC) ? tx('split.blockStrip.exclude') : tx('common.use') })}</T>
      )}
      <T mono size={8} dim style={ss.mt2}>
        {`${blockSummary(list).map(([k, v]) => `${k} ${fmtDur(v)}`).join(' / ')} · 無音とチャプターの区切りで分割 · 押すと1つ、なぞると範囲ごと採用/除外を反転（色付き=採用）`}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { height: 16, marginTop: 4, borderRadius: 3 },
  clip: { borderRadius: 3, overflow: 'hidden' },
  dragRange: { position: 'absolute', top: -2, bottom: -2, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1.5, borderRadius: 3, zIndex: 4 },
  lensBlocks: { position: 'absolute', left: 0, right: 0, top: LENS_R - 11, height: 22 },
  lensCenter: { position: 'absolute', left: LENS_R - 1, top: 6, bottom: 6, width: 2, opacity: 0.6 },
});
