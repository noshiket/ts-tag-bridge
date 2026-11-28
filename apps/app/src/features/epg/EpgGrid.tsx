import { inWindow, isUnified, programStatus, type EpgEvent, type reserveMaps } from '@tstag/core';
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import { Animated, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { ProgramCell } from './ProgramCell';
import { useBlockPageZoom, useGridZoom } from './useGridZoom';
import { shadow } from '../../ui/theme/edge';

export const HOURS = 24;
export const HEADER_H = 40;
export const RULER_W = 38;
const HOUR = 3_600_000;

/** 1つの列（Grid は局、Week はその局の1日）。subs はサブチャンネルごとの番組 */
export interface GridColumn {
  key: string;
  header: ReactNode;
  /** その列の1日の始まり（朝4時） */
  start: number;
  subs: EpgEvent[][];
}

export interface EpgGridHandle {
  /** その列が見える所まで横に動かす */
  scrollToColumn(idx: number): void;
  /** 縦の位置（px） */
  scrollToY(y: number): void;
}

/**
 * 番組表の格子（元の MultiChannelGrid と WeekView）。Grid は局を、Week はその局の8日を横に並べる。
 * 左の時刻・上の見出しは動かず、番組の所だけ縦横に動く。React Native は縦横の両方で止める見出しを持てないので、
 * 見出しと番組を同じ横の動きに、時刻を番組の縦の動きに合わせる。サブチャンネルは同じ時間に別の番組がある時だけ列を分ける
 */
export const EpgGrid = forwardRef<EpgGridHandle, {
  columns: GridColumn[];
  now: number;
  /** 拡大縮小した後の大きさ（基準 × scale、縦はさらに × vZoom） */
  pxPerHour: number;
  colWidth: number;
  /** 拡大縮小。番組の所をつまむと縦横とも、時刻の列をつまむと時間の軸だけ（元と同じ） */
  zoom: { scale: number; vZoom: number; colBase: number; onChange: (z: { scale?: number; vZoom?: number }) => void };
  maps: ReturnType<typeof reserveMaps>;
  forces: Record<string, number> | undefined;
  onPress: (e: EpgEvent) => void;
}>(function EpgGrid({ columns, now, pxPerHour, colWidth, zoom, maps, forces, onPress }, ref) {
  const { theme, accent } = useTheme();
  // 今のスクロールと幅（つまんだ所を覚える・縮める下限を決めるのに使う）
  const scroll = useRef({ x: 0, y: 0 });
  const width = useRef(0);
  const hRef = useRef<ScrollViewInstance>(null);
  const vRef = useRef<ScrollViewInstance>(null);
  // 縦のスクロール（時刻の列をこれに合わせて動かす。JS を通さず描画の側で動かすので、スクロールの度に遅れない）
  const scrollY = useRef(new Animated.Value(0)).current;
  const { both, vertical, lanesStyle, headStyle, rulerStyle } = useGridZoom({ zoom, pxPerHour, colWidth, columnCount: columns.length, scroll, width, hRef, vRef });
  useImperativeHandle(ref, () => ({
    scrollToColumn: (idx) => hRef.current?.scrollTo({ x: idx * colWidth, animated: true }),
    scrollToY: (y) => vRef.current?.scrollTo({ y, animated: false }),
  }), [colWidth]);
  const total = HOURS * pxPerHour;
  // 今の時刻の線（その日の列だけ。時刻の側の印は今日の列があれば出す）
  const nowTopOf = (start: number) => ((now - start) / HOUR) * pxPerHour;
  const today = columns.find((c) => nowTopOf(c.start) >= 0 && nowTopOf(c.start) <= total);
  const rulerStart = columns[0]?.start ?? 0;
  const onV = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: true,
    listener: (ev: NativeSyntheticEvent<NativeScrollEvent>) => { scroll.current.y = ev.nativeEvent.contentOffset.y; },
  });
  const onH = (ev: NativeSyntheticEvent<NativeScrollEvent>) => { scroll.current.x = ev.nativeEvent.contentOffset.x; };
  const frameRef = useBlockPageZoom();
  const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  return (
    <View ref={frameRef as never} style={[styles.frame, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
      {/* 左: 時刻（番組の縦の動きに合わせて動く）。ここをつまむと時間の軸だけ伸び縮みする */}
      <GestureDetector gesture={vertical}>
      <View style={[styles.ruler, { borderRightColor: theme.ink, backgroundColor: theme.surface }]}>
        <View style={[styles.corner, { borderBottomColor: theme.ink }]} />
        <View style={styles.rulerClip}>
          <Animated.View style={{ transform: [{ translateY: Animated.multiply(scrollY, -1) }] }}>
          <Animated.View style={[{ height: total }, rulerStyle]}>
            {Array.from({ length: HOURS }, (_, i) => (
              <View key={i} style={[styles.hour, { top: i * pxPerHour, height: pxPerHour, borderBottomColor: theme.line }]}>
                <T mono size={13} w={800} style={styles.lh1}>{String(new Date(rulerStart + i * HOUR).getHours()).padStart(2, '0')}</T>
                <T mono size={8} dim>:00</T>
              </View>
            ))}
            {today && (
              <View pointerEvents="none" style={[styles.nowTag, { top: nowTopOf(today.start) - 8, backgroundColor: accent.primary }]}>
                <T mono size={8} w={800} color="#fff">{hhmm(now)}</T>
              </View>
            )}
          </Animated.View>
          </Animated.View>
        </View>
      </View>

      </GestureDetector>

      {/* 右: 局名と番組（横に一緒に動く） */}
      <GestureDetector gesture={both}>
      <View style={styles.grow} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}>
      <ScrollView ref={hRef} horizontal showsHorizontalScrollIndicator={false} style={styles.grow} onScroll={onH} scrollEventThrottle={16}>
        <View>
          <Animated.View style={[styles.headRow, { borderBottomColor: theme.ink }, headStyle]}>
            {columns.map((c, i) => (
              <View key={c.key} style={[styles.headCell, { width: colWidth, borderRightColor: theme.line }, i === columns.length - 1 && styles.noRight]}>{c.header}</View>
            ))}
          </Animated.View>
          <Animated.ScrollView ref={vRef} onScroll={onV} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.lanes, { height: total }, lanesStyle]}>
              {columns.map((c, ci) => {
                const subs = c.subs.map((list) => list.filter((e) => inWindow(e, c.start)));
                const subW = Math.floor(colWidth / subs.length);
                const windowStart = c.start;
                const nowTop = nowTopOf(c.start);
                // 今がこの列の範囲に入っていれば描く（局ごとの表示は全部の列、週の表示は今日の列だけ。元と同じ）
                const showNow = nowTop >= 0 && nowTop <= total;
                return (
                  <View key={c.key} style={[styles.lane, { width: colWidth, borderRightColor: theme.line }, ci === columns.length - 1 && styles.noRight]}>
                    {Array.from({ length: HOURS }, (_, i) => (
                      <View key={i} style={[styles.line, { top: i * pxPerHour, borderTopColor: theme.line }]} />
                    ))}
                    {Array.from({ length: HOURS }, (_, i) => (
                      <View key={`h${i}`} style={[styles.line, styles.half, { top: i * pxPerHour + pxPerHour / 2, borderTopColor: theme.line }]} />
                    ))}
                    {showNow && <View pointerEvents="none" style={[styles.nowLine, { top: nowTop, backgroundColor: accent.primary }]} />}
                    {subs.flatMap((list, si) => list.map((e) => {
                      const rawTop = ((Date.parse(e.start_time) - windowStart) / HOUR) * pxPerHour;
                      const rawH = (e.duration_sec / 3600) * pxPerHour - 2;
                      if (rawTop + rawH < 0 || rawTop > total) return null;
                      const unified = isUnified(subs, e, si);
                      if (unified && si > 0) return null;
                      const top = Math.max(0, rawTop);
                      return (
                        <ProgramCell key={`${si}-${e.event_id}`} e={e} top={top} height={Math.max(Math.min(rawTop + rawH, total) - top, 24)} scale={zoom.scale}
                          left={unified ? 2 : si * subW + 2} width={unified ? colWidth : subW} status={programStatus(maps, e)}
                          force={forces?.[`${e.onid}-${e.sid}`]} now={now} onPress={onPress} />
                      );
                    }))}
                  </View>
                );
              })}
            </Animated.View>
          </Animated.ScrollView>
        </View>
      </ScrollView>
      </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, overflow: 'hidden' },
  ruler: { width: RULER_W, borderRightWidth: 1.5, zIndex: 3 },
  rulerClip: { flex: 1, overflow: 'hidden' },
  corner: { height: HEADER_H, borderBottomWidth: 1.5 },
  hour: { position: 'absolute', left: 0, right: 0, borderBottomWidth: 1, borderStyle: 'dashed', paddingTop: 4, paddingLeft: 4 },
  lh1: { lineHeight: 13 },
  nowTag: { position: 'absolute', left: 1, right: 1, borderRadius: 3, alignItems: 'center', paddingVertical: 1 },
  grow: { flex: 1 },
  headRow: { flexDirection: 'row', height: HEADER_H, borderBottomWidth: 1.5 },
  headCell: { borderRightWidth: 1 },
  noRight: { borderRightWidth: 0 },
  lanes: { flexDirection: 'row' },
  lane: { position: 'relative', borderRightWidth: 1 },
  line: { position: 'absolute', left: 0, right: 0, height: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  half: { borderStyle: 'dotted', opacity: 0.5 },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.85, zIndex: 1 },
});
